import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AppConfigService } from '@/config/app-config.service';
import { UnauthenticatedError } from '@/common/errors/domain-error';
import { AuthService, type AuthResult } from './auth.service';
import { RequestOtpDto } from './dto/request-otp.dto';
import { RequestOtpResponseDto } from './dto/request-otp-response.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { LoginDto } from './dto/login.dto';
import { GoogleAuthDto } from './dto/google-auth.dto';
import { CompleteRegistrationDto } from './dto/complete-registration.dto';
import { CompletePasswordResetDto } from './dto/complete-password-reset.dto';
import { AuthSessionDto } from './dto/auth-session.dto';
import { Public } from './decorators/public.decorator';
import { REFRESH_COOKIE_NAME, clearRefreshCookie, setRefreshCookie } from './cookie.util';
import type { RequestMeta } from './refresh-token.service';

function requestMeta(req: Request): RequestMeta {
  return { userAgent: req.headers['user-agent'], ip: req.ip };
}

function toSessionDto(result: AuthResult): AuthSessionDto {
  return {
    accessToken: result.accessToken,
    activeRole: result.activeRole,
    roleChosen: result.roleChosen,
    profileDone: result.profileDone,
    isNewUser: result.isNewUser,
  };
}

/**
 * Bosqich 21 — parol bilan login. `POST /auth/login` — asosiy invariant:
 * SMS UMUMAN ishtirok etmaydi (`AuthService.login` `OtpService`ni hech
 * qachon chaqirmaydi). SMS FAQAT ro'yxatdan o'tish (`/register/*`) va
 * parolni tiklashda (`/password-reset/*`) — telefon egaligini isbotlash
 * uchun.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfigService,
  ) {}

  /* ── REGISTER ─────────────────────────────────────────────────────────── */

  /** Har doim generic `{ sent: true }` (enumeration himoyasi — bu marshrut
      istisno emas, har doim SMS yuboradi, chunki istalgan telefon
      ro'yxatdan o'tishi mumkin). */
  @Public()
  @Post('register/request-otp')
  @HttpCode(200)
  @ApiOkResponse({ type: RequestOtpResponseDto })
  async requestRegisterOtp(@Body() dto: RequestOtpDto, @Req() req: Request): Promise<RequestOtpResponseDto> {
    const { devOtp } = await this.auth.requestRegisterOtp(dto.phone, req.ip);
    return devOtp ? { sent: true, devOtp } : { sent: true };
  }

  /** OTP valid bo'lsa User DARHOL yaratilmaydi — o'rniga qisqa umrli
      `registrationToken` (10 daqiqa, bir martalik). */
  @Public()
  @Post('register/verify-otp')
  @HttpCode(200)
  async verifyRegisterOtp(@Body() dto: VerifyOtpDto, @Req() req: Request): Promise<{ registrationToken: string }> {
    return this.auth.verifyRegisterOtp(dto.phone, dto.code, req.ip);
  }

  /** Grant valid + parol mos bo'lsa: User yaratiladi, sessiya ochiladi.
      Telefon allaqachon ro'yxatdan o'tgan bo'lsa `PHONE_EXISTS` (409). */
  @Public()
  @Post('register/complete')
  @HttpCode(200)
  @ApiOkResponse({ type: AuthSessionDto })
  async completeRegistration(
    @Body() dto: CompleteRegistrationDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSessionDto> {
    const result = await this.auth.completeRegistration(
      dto.registrationToken,
      dto.password,
      dto.confirmPassword,
      requestMeta(req),
    );
    this.setCookie(res, result.refreshToken);
    return toSessionDto(result);
  }

  /* ── LOGIN — telefon + parol, SMS YO'Q ───────────────────────────────── */

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOkResponse({ type: AuthSessionDto })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSessionDto> {
    const result = await this.auth.login(dto.phone, dto.password, requestMeta(req));
    this.setCookie(res, result.refreshToken);
    return toSessionDto(result);
  }

  /* ── GOOGLE AUTH ──────────────────────────────────────────────────────── */

  @Public()
  @Post('google')
  @HttpCode(200)
  @ApiOkResponse({ type: AuthSessionDto })
  async googleAuth(
    @Body() dto: GoogleAuthDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSessionDto> {
    const result = await this.auth.googleAuth(dto, requestMeta(req));
    this.setCookie(res, result.refreshToken);
    return toSessionDto(result);
  }

  /* ── FORGOT PASSWORD ──────────────────────────────────────────────────── */

  /** Har doim generic `{ sent: true }` — noma'lum telefon uchun ham bir xil
      javob, lekin haqiqiy SMS yuborilmaydi (`AuthService.
      requestPasswordResetOtp` ichida `skipDelivery`, SMS xarajatini
      tejash uchun; rate-limit baribir to'liq qo'llanadi). */
  @Public()
  @Post('password-reset/request-otp')
  @HttpCode(200)
  @ApiOkResponse({ type: RequestOtpResponseDto })
  async requestPasswordResetOtp(@Body() dto: RequestOtpDto, @Req() req: Request): Promise<RequestOtpResponseDto> {
    const { devOtp } = await this.auth.requestPasswordResetOtp(dto.phone, req.ip);
    return devOtp ? { sent: true, devOtp } : { sent: true };
  }

  /** OTP valid bo'lsa qisqa umrli `resetToken` (10 daqiqa, bir martalik). */
  @Public()
  @Post('password-reset/verify-otp')
  @HttpCode(200)
  async verifyPasswordResetOtp(@Body() dto: VerifyOtpDto, @Req() req: Request): Promise<{ resetToken: string }> {
    return this.auth.verifyPasswordResetOtp(dto.phone, dto.code, req.ip);
  }

  /** Grant valid + parol mos bo'lsa: parol yangilanadi, BARCHA mavjud
      sessiyalar bekor qilinadi. Sessiya AVTOMATIK OCHILMAYDI — foydalanuvchi
      yangi parol bilan `/auth/login`ga qaytadi (bo'lim 20/39). */
  @Public()
  @Post('password-reset/complete')
  @HttpCode(200)
  async completePasswordReset(@Body() dto: CompletePasswordResetDto): Promise<{ ok: true }> {
    await this.auth.completePasswordReset(dto.resetToken, dto.password, dto.confirmPassword);
    return { ok: true };
  }

  /* ── Sessiya (o'zgarmagan) ────────────────────────────────────────────── */

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOkResponse({ type: AuthSessionDto })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSessionDto> {
    const raw = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
    if (!raw) throw new UnauthenticatedError('Sessiya topilmadi', 'NO_SESSION');
    const result = await this.auth.refresh(raw, requestMeta(req));
    this.setCookie(res, result.refreshToken);
    return toSessionDto(result);
  }

  /**
   * Joriy qurilma/sessiyadan chiqish. Boshqa sessiyalarga tegmaydi.
   * `@Public()` — access token eskirgan (15 daqiqadan oshgan) bo'lsa ham
   * foydalanuvchi logout qila olishi, cookie tozalanishi va DB'dagi
   * refresh token bekor qilinishi shart.
   */
  @Public()
  @Post('logout')
  @HttpCode(200)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    const raw = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
    if (raw) await this.auth.logout(raw);
    clearRefreshCookie(res, this.config.isProduction);
    return { ok: true };
  }

  private setCookie(res: Response, refreshToken: string): void {
    setRefreshCookie(res, refreshToken, this.config.jwt.refreshTtl, this.config.isProduction);
  }
}
