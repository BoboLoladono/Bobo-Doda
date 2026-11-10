export const CLICK_MERCHANT_CONFIG = Symbol('CLICK_MERCHANT_CONFIG');

export interface ClickMerchantConfig {
  merchantId: string;
  serviceId: string;
  secretKey: string;
  checkoutUrl?: string;
}

export interface ClickRequestDto {
  click_trans_id: number | string;
  service_id: number | string;
  click_paydoc_id?: number | string;
  merchant_trans_id: string;
  amount: number | string;
  action: number;
  error: number | string;
  error_note?: string;
  sign_time: string;
  sign_string: string;
  merchant_prepare_id?: number | string;
}

export interface ClickResponseDto {
  click_trans_id: number | string;
  merchant_trans_id: string;
  merchant_prepare_id?: number | string;
  merchant_confirm_id?: number | string;
  error: number;
  error_note: string;
}
