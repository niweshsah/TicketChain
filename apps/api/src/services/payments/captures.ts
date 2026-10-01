import { randomUUID } from 'node:crypto';
import { config } from '../../shared/config';
import { one, transaction } from '../../shared/db';
import { assertRule, requireValue } from '../../shared/errors';
import { publishIntent } from '../../shared/infrastructure/messages';
import { type Operation } from '../../shared/types';
import { fulfill } from '../../shared/standalone';

export async function recordCapture(
  orderId: string,
  paymentId: string,
  amount: bigint,
  currency: string,
  sender?: string,
) {
  if (config.SERVICE_NAME !== 'payments')
    return fulfill(orderId, paymentId, amount, currency, sender);
  await transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
      `capture:${paymentId}`,
    );
    const reused = await one<{ order_id: string }>(
      tx,
      'SELECT order_id FROM tc_provideroperation WHERE payment_id=$1',
      paymentId,
    );
    assertRule(
      !reused || reused.order_id === orderId,
      'PAYMENT_REPLAY',
      'This captured payment already belongs to another order',
    );
    const operation = requireValue(
      await one<Operation>(
        tx,
        "SELECT * FROM tc_provideroperation WHERE order_id=$1::uuid AND kind='payment' FOR UPDATE",
        orderId,
      ),
    );
    assertRule(amount > 0n, 'PAYMENT_MISMATCH', 'Invalid captured amount');
    if (operation.payment_id && operation.payment_id !== paymentId) {
      await tx.$executeRawUnsafe(
        'INSERT INTO tc_provideroperation(id,order_id,kind,provider,payment_id,data) VALUES($1::uuid,$2::uuid,$3,$4,$5,$6::jsonb) ON CONFLICT(order_id,kind) DO NOTHING',
        randomUUID(),
        orderId,
        `extra:${paymentId}`,
        operation.provider,
        paymentId,
        JSON.stringify({ amount: amount.toString(), currency, sender }),
      );
    } else
      await tx.$executeRawUnsafe(
        "UPDATE tc_provideroperation SET status='captured',payment_id=COALESCE(payment_id,$2),data=CASE WHEN payment_id IS NULL THEN data || $3::jsonb ELSE data END WHERE id=$1::uuid",
        operation.id,
        paymentId,
        JSON.stringify({ sender }),
      );
    await publishIntent(
      tx,
      'payment.captured',
      orderId,
      {
        orderId,
        paymentId,
        amount: amount.toString(),
        currency,
        sender,
        operationId: operation.id,
        provider: operation.provider,
        externalId: operation.external_id,
      },
      'booking',
      `capture:${paymentId}`,
    );
  });
}
