import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../../../shared/config';
import { AppError, assertRule } from '../../../shared/errors';
import { type Purchase } from '../../../shared/types';

import { AmbiguousOperation } from '../../../shared/provider-errors';
export { AmbiguousOperation };

export function validHmac(
  secret: string,
  message: string | Buffer,
  signature: string,
): boolean {
  if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(message).digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}

export interface RazorOrder {
  id: string;
  amount: number;
  currency: string;
  receipt: string;
}

export interface RazorPayment {
  id: string;
  order_id: string;
  amount: number;
  currency: string;
  status: string;
  created_at: number;
}

export interface RazorRefund {
  id: string;
  status: string;
  payment_id: string;
  amount: number;
  notes?: Record<string, string>;
}

export async function razor<T>(
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`https://api.razorpay.com/v1${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.RAZORPAY_KEY_ID}:${config.RAZORPAY_KEY_SECRET}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new AmbiguousOperation(
      'Provider response unknown; reconcile before retry',
    );
  }
  if (!response.ok) {
    if (response.status >= 500)
      throw new AmbiguousOperation('Provider server outcome unknown');
    throw new AppError(
      502,
      'PROVIDER_REJECTED',
      'Provider rejected the request',
    );
  }
  return response.json() as Promise<T>;
}

export function validateCaptured(
  p: RazorPayment,
  order: Purchase,
  providerOrder: string,
) {
  assertRule(
    p.status === 'captured' &&
      p.order_id === providerOrder &&
      p.currency === order.currency &&
      BigInt(p.amount) === order.total,
    'PAYMENT_MISMATCH',
    'Payment is not captured for the correct order, amount, and currency',
  );
}
