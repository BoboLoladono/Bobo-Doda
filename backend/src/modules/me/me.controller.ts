import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Res, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AppConfigService } from '@/config/app-config.service';
import { AuthService, type AuthResult } from '@/modules/auth/auth.service';
import { CurrentUser } from '@/modules/auth/decorators/current-user.decorator';
import type { AccessTokenPayload } from '@/modules/auth/types/token-payload';
import { setRefreshCookie } from '@/modules/auth/cookie.util';
import { AuthSessionDto } from '@/modules/auth/dto/auth-session.dto';
import { ChooseRoleDto } from '@/modules/auth/dto/choose-role.dto';
import { AccountStatusGuard } from '@/common/guards/account-status.guard';
import { MeService } from './me.service';
import { MeResponseDto } from './dto/me-response.dto';
import { SessionDto } from './dto/session.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

function toSessionDto(result: AuthResult): AuthSessionDto {
  return {
    accessToken: result.accessToken,
    activeRole: result.activeRole,
    roleChosen: result.roleChosen,
    profileDone: result.profileDone,
    isNewUser: result.isNewUser,
  };
}

@ApiTags('me')
@Controller('me')
export class MeController {
  constructor(
    private readonly me: MeService,
    private readonly auth: AuthService,
    private readonly config: AppConfigService,
  ) {}

  @Get()
  @ApiOkResponse({ type: MeResponseDto })
  async getMe(@CurrentUser() user: AccessTokenPayload): Promise<MeResponseDto> {
    return this.me.getMe(user.sub, user.activeRole);
  }

  /** Bosqich 3 — profil tahriri. Bloklangan/cheklangan hisob YOZOLMAYDI. */
  @Patch('profile')
  @UseGuards(AccountStatusGuard)
  @ApiOkResponse({ type: MeResponseDto })
  async updateProfile(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: UpdateProfileDto,
  ): Promise<MeResponseDto> {
    return this.me.updateProfile(user.sub, dto, user.activeRole);
  }

  @Post('roles/choose')
  @UseGuards(AccountStatusGuard)
  @HttpCode(200)
  @ApiOkResponse({ type: AuthSessionDto })
  async chooseRole(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: ChooseRoleDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSessionDto> {
    const result = await this.auth.chooseRole(user, dto.role);
    this.setCookie(res, result.refreshToken);
    return toSessionDto(result);
  }

  @Post('roles/switch')
  @UseGuards(AccountStatusGuard)
  @HttpCode(200)
  @ApiOkResponse({ type: AuthSessionDto })
  async switchRole(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: ChooseRoleDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSessionDto> {
    const result = await this.auth.switchRole(user, dto.role);
    this.setCookie(res, result.refreshToken);
    return toSessionDto(result);
  }

  @Get('sessions')
  @ApiOkResponse({ type: [SessionDto] })
  async listSessions(@CurrentUser() user: AccessTokenPayload): Promise<SessionDto[]> {
    return this.me.listSessions(user.sub, user.familyId);
  }

  /** Bosqich 21 — joriy parolni bilgan holda almashtirish (recovery EMAS,
      `AuthService.completePasswordReset`dan farqli — boshqa sessiyalar
      bekor QILINMAYDI). */
  @Post('change-password')
  @UseGuards(AccountStatusGuard)
  @HttpCode(200)
  async changePassword(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: ChangePasswordDto,
  ): Promise<{ ok: true }> {
    await this.auth.changePassword(user.sub, dto.currentPassword, dto.newPassword);
    return { ok: true };
  }

  /** Bitta sessiyani tugatish — FAQAT o'ziniki (`MeService.revokeSession` query-scoping). */
  @Delete('sessions/:id')
  @HttpCode(200)
  async revokeSession(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
  ): Promise<{ ok: true }> {
    await this.me.revokeSession(user.sub, id);
    return { ok: true };
  }

  /** Hamma qurilmadan chiqish. */
  @Delete('sessions')
  @HttpCode(200)
  async revokeAllSessions(@CurrentUser() user: AccessTokenPayload): Promise<{ ok: true }> {
    await this.me.revokeAllSessions(user.sub);
    return { ok: true };
  }

  private setCookie(res: Response, refreshToken: string): void {
    setRefreshCookie(res, refreshToken, this.config.jwt.refreshTtl, this.config.isProduction);
  }
}
