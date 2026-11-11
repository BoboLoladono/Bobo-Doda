import 'reflect-metadata';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';

/**
 * Tuzilmaviy himoya (2026-09 production 500 regressiyasi): butun-obyekt
 * `@Query()`/`@Body()` parametrining TS tipi `Object`ga o'chib ketsa
 * (intersection `PageQueryDto & {...}`, inline tip, interface, `unknown`),
 * global `ValidationPipe` uni UMUMAN transform/validatsiya qilmaydi —
 * `GET /staff/services?perPage=1` aynan shunday `take: "1"` bilan Prisma'ga
 * yetib 500 berdi. Contracts-drift gate buni USHLAY OLMAYDI: generator ham,
 * committed openapi.json ham bir xil `parameters: []`ni ko'radi.
 */
const DELIBERATELY_UNTYPED = new Set<string>([
  // Payme JSON-RPC 2.0 konverti: Basic auth bilan himoyalangan, har metod
  // parametrlari servisda alohida tekshiriladi (bitta DTO bilan ifodalab bo'lmaydi).
  'PaymeMerchantController.handle',
]);

const ERASED_TYPES: ReadonlySet<unknown> = new Set<unknown>([undefined, Object, String, Number, Boolean, Array]);

function controllerFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return controllerFiles(full);
    return name.endsWith('.controller.ts') ? [full] : [];
  });
}

interface RouteArg {
  index: number;
  data?: unknown;
}

function scanWholeObjectParams(): { checked: string[]; offenders: string[] } {
  const checked: string[] = [];
  const offenders: string[] = [];
  for (const file of controllerFiles(join(__dirname, '..', '..'))) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- dinamik skan: har controller faylini yuklaymiz
    const exported = require(file) as Record<string, unknown>;
    for (const candidate of Object.values(exported)) {
      if (typeof candidate !== 'function' || !Reflect.hasOwnMetadata(PATH_METADATA, candidate)) continue;
      const controller = candidate as { name: string; prototype: object };
      for (const method of Object.getOwnPropertyNames(controller.prototype)) {
        if (method === 'constructor') continue;
        const args = (Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, method) ?? {}) as Record<string, RouteArg>;
        const paramTypes = (Reflect.getMetadata('design:paramtypes', controller.prototype, method) ?? []) as unknown[];
        for (const [key, arg] of Object.entries(args)) {
          const [kindStr] = key.split(':');
          if (kindStr !== String(RouteParamtypes.QUERY) && kindStr !== String(RouteParamtypes.BODY)) continue;
          if (arg.data !== undefined) continue; // `@Query('x')` — bitta maydon, butun obyekt emas
          const label = `${controller.name}.${method}`;
          checked.push(label);
          if (ERASED_TYPES.has(paramTypes[arg.index]) && !DELIBERATELY_UNTYPED.has(label)) {
            offenders.push(`${label} (${kindStr === String(RouteParamtypes.QUERY) ? '@Query' : '@Body'} #${arg.index})`);
          }
        }
      }
    }
  }
  return { checked, offenders };
}

describe('Controller @Query()/@Body() tiplari ValidationPipe uchun ko‘rinadi', () => {
  const { checked, offenders } = scanWholeObjectParams();

  it('skaner haqiqatan controller parametrlarini topadi (bo‘sh natija soxta "yashil" bo‘lmasin)', () => {
    expect(checked.length).toBeGreaterThan(20);
    expect(checked).toContain('StaffServiceController.list');
    expect(checked).toContain('StaffSellerApplicationController.list');
  });

  it('hech bir butun-obyekt @Query()/@Body() tipi Object/primitive’ga o‘chmagan (aks holda ValidationPipe uni chetlab o‘tadi)', () => {
    expect(offenders).toEqual([]);
  });
});
