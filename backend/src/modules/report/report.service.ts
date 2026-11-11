import { Injectable } from '@nestjs/common';
import {
  Prisma,
  TrustReportActionTaken,
  TrustReportReasonType,
  TrustReportSeverity,
  TrustReportStatus,
  TrustReportTargetType,
} from '@prisma/client';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { IdFactory } from '@/common/id/id.factory';
import { NotFoundError } from '@/common/errors/domain-error';
import { AuditService, type AuditActor } from '@/common/audit/audit.service';
import { buildPage } from '@/common/pagination/page-query.dto';
import { CreateReportDto } from './dto/create-report.dto';
import { ListReportsQueryDto } from './dto/list-reports-query.dto';
import { StaffUpdateReportDto } from './dto/staff-update-report.dto';

@Injectable()
export class ReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ids: IdFactory,
    private readonly audit: AuditService,
  ) {}

  async createReport(reporterId: string, dto: CreateReportDto) {
    const reportId = this.ids.next();
    const targetType = dto.targetType.toUpperCase() as TrustReportTargetType;
    const reasonType = dto.reasonType.toUpperCase() as TrustReportReasonType;
    const severity = (dto.severity?.toUpperCase() || 'MEDIUM') as TrustReportSeverity;

    const report = await this.prisma.trustReport.create({
      data: {
        id: reportId,
        reporterId,
        targetType,
        targetId: dto.targetId,
        targetTitle: dto.targetTitle,
        reasonType,
        description: dto.description,
        evidenceUrl: dto.evidenceUrl || null,
        severity,
        status: TrustReportStatus.NEW,
        actionTaken: TrustReportActionTaken.NONE,
      },
      include: {
        reporter: { select: { id: true, fullName: true, phone: true } },
      },
    });

    return report;
  }

  async getByIdOrThrow(id: string) {
    const report = await this.prisma.trustReport.findUnique({
      where: { id },
      include: {
        reporter: { select: { id: true, fullName: true, phone: true } },
      },
    });
    if (!report) throw new NotFoundError('Shikoyat topilmadi', 'REPORT_NOT_FOUND');
    return report;
  }

  async listForStaff(query: ListReportsQueryDto) {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 10;
    const where: Prisma.TrustReportWhereInput = {};

    if (query.status && query.status !== 'all') {
      where.status = query.status.toUpperCase() as TrustReportStatus;
    }

    if (query.category && query.category !== 'all') {
      where.reasonType = query.category.toUpperCase() as TrustReportReasonType;
    }

    if (query.severity && query.severity !== 'all') {
      where.severity = query.severity.toUpperCase() as TrustReportSeverity;
    }

    if (query.search?.trim()) {
      const q = query.search.trim();
      where.OR = [
        { targetTitle: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { reporter: { fullName: { contains: q, mode: 'insensitive' } } },
      ];
    }

    const [items, total, allCount, newCount, investigatingCount, resolvedCount, dismissedCount, highCount] =
      await Promise.all([
        this.prisma.trustReport.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * perPage,
          take: perPage,
          include: {
            reporter: { select: { id: true, fullName: true, phone: true } },
          },
        }),
        this.prisma.trustReport.count({ where }),
        this.prisma.trustReport.count(),
        this.prisma.trustReport.count({ where: { status: TrustReportStatus.NEW } }),
        this.prisma.trustReport.count({ where: { status: TrustReportStatus.INVESTIGATING } }),
        this.prisma.trustReport.count({ where: { status: TrustReportStatus.RESOLVED } }),
        this.prisma.trustReport.count({ where: { status: TrustReportStatus.DISMISSED } }),
        this.prisma.trustReport.count({
          where: { severity: { in: [TrustReportSeverity.HIGH, TrustReportSeverity.CRITICAL] } },
        }),
      ]);

    const facets: Record<string, number> = {
      _all: allCount,
      new: newCount,
      investigating: investigatingCount,
      resolved: resolvedCount,
      dismissed: dismissedCount,
      'severity:high': highCount,
    };

    const paged = buildPage(items, total, page, perPage);
    return { ...paged, facets };
  }

  async updateReportAsStaff(reportId: string, dto: StaffUpdateReportDto, actor: AuditActor) {
    const existing = await this.getByIdOrThrow(reportId);
    const nextStatus = dto.action.toUpperCase() as TrustReportStatus;
    const actionTaken = (dto.userAction?.toUpperCase() || 'NONE') as TrustReportActionTaken;
    const now = new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      const report = await tx.trustReport.update({
        where: { id: reportId },
        data: {
          status: nextStatus,
          assignedAdminId: actor.id,
          assignedAdminName: actor.name,
          resolutionNote: dto.note,
          actionTaken,
          resolvedAt:
            nextStatus === TrustReportStatus.RESOLVED || nextStatus === TrustReportStatus.DISMISSED
              ? now
              : existing.resolvedAt,
        },
        include: {
          reporter: { select: { id: true, fullName: true, phone: true } },
        },
      });

      await this.audit.record(
        {
          actor,
          action: 'REPORT_REVIEWED',
          resourceType: 'TRUST_REPORT',
          resourceId: reportId,
          contextId: existing.reporterId,
          previousState: { status: existing.status, actionTaken: existing.actionTaken },
          newState: { status: nextStatus, actionTaken, note: dto.note },
        },
        tx,
      );

      return report;
    });

    return updated;
  }
}
