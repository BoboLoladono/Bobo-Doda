export interface BuildClickCheckoutUrlParams {
  checkoutUrl?: string;
  serviceId: string;
  merchantId: string;
  paymentId: string;
  amountUzs: number;
  returnUrl?: string;
}

export function buildClickCheckoutUrl(params: BuildClickCheckoutUrlParams): string {
  const base = params.checkoutUrl || 'https://my.click.uz/services/pay';
  const url = new URL(base);
  url.searchParams.set('service_id', params.serviceId);
  url.searchParams.set('merchant_id', params.merchantId);
  url.searchParams.set('amount', params.amountUzs.toFixed(2));
  url.searchParams.set('transaction_param', params.paymentId);
  if (params.returnUrl) {
    url.searchParams.set('return_url', params.returnUrl);
  }
  return url.toString();
}
