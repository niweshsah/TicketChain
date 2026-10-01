import { config } from '../../shared/config';
import { transaction } from '../../shared/db';
import { assertRule } from '../../shared/errors';
import { enqueue } from '../../shared/infrastructure/jobs';
import { validHmac } from './razorpay/client';

export async function ingestWebhook(
  raw: Buffer,
  signature: string,
  eventId: string,
) {
  assertRule(
    config.PAYMENT_PROVIDER === 'razorpay' &&
      validHmac(config.RAZORPAY_WEBHOOK_SECRET!, raw, signature),
    'INVALID_SIGNATURE',
    'Invalid webhook signature',
    400,
  );
  assertRule(
    eventId.length > 0 && eventId.length <= 200,
    'EVENT_ID_REQUIRED',
    'Provider event ID required',
    400,
  );
  const payload: unknown = JSON.parse(raw.toString());
  await transaction(async (tx) => {
    const inserted = await tx.$executeRawUnsafe(
      'INSERT INTO tc_webhookevent(id,payload) VALUES($1,$2::jsonb) ON CONFLICT(id) DO NOTHING',
      eventId,
      JSON.stringify(payload),
    );
    if (inserted)
      await enqueue(tx, 'webhook', `webhook:${eventId}`, { eventId });
  });
}
