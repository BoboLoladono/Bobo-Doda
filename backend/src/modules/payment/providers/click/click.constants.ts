/**
 * Click Merchant API xatolik kodlari va konstantalari.
 * Rasmiy docs.click.uz spetsifikatsiyasi bo'yicha:
 *  0: Muvaffaqiyatli
 * -1: Imzo tekshiruvi muvaffaqiyatsiz (SIGN CHECK FAILED)
 * -2: Noto'g'ri summa (INCORRECT AMOUNT)
 * -3: Amaliyot topilmadi (ACTION NOT FOUND)
 * -4: Allaqachon to'langan (ALREADY PAID)
 * -5: Foydalanuvchi/To'lov topilmadi (USER OR TRANSACTION DOES NOT EXIST)
 * -6: Tranzaksiya topilmadi (TRANSACTION DOES NOT EXIST)
 * -7: Foydalanuvchi ma'lumotlarini yangilashda xatolik
 * -8: Click so'rovida xatolik (ERROR IN REQUEST FROM CLICK)
 * -9: Tranzaksiya bekor qilingan (TRANSACTION CANCELLED)
 */

export const CLICK_ERROR = {
  SUCCESS: 0,
  SIGN_CHECK_FAILED: -1,
  INCORRECT_AMOUNT: -2,
  ACTION_NOT_FOUND: -3,
  ALREADY_PAID: -4,
  USER_DOES_NOT_EXIST: -5,
  TRANSACTION_DOES_NOT_EXIST: -6,
  FAILED_TO_UPDATE_USER: -7,
  ERROR_IN_REQUEST: -8,
  TRANSACTION_CANCELLED: -9,
} as const;

export const CLICK_ACTION = {
  PREPARE: 0,
  COMPLETE: 1,
} as const;
