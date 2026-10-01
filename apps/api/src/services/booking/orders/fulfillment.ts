import { randomUUID, randomBytes } from 'node:crypto';
import { config } from '../../../shared/config';
import { rows, one, transaction } from '../../../shared/db';
import { assertRule, requireValue } from '../../../shared/errors';
import { enqueue } from '../../../shared/infrastructure/jobs';
import { publishIntent } from '../../../shared/infrastructure/messages';
import { type Purchase } from '../../../shared/types';
import { notifyEvent, lockEvent, lockTiers } from '../events/queries';
import { expireEvent, allocate } from './inventory';
import { queueRefund } from './refunds';

export async function fulfill(
  orderId: string,
  paymentId: string,
  amount: bigint,
  currency: string,
  sender?: string,
) {
  return transaction(async (tx) => {
    const purchaseReference = requireValue(
      await one<Purchase>(
        tx,
        'SELECT * FROM tc_purchase WHERE id=$1::uuid',
        orderId,
      ),
    );
    const event = await lockEvent(tx, purchaseReference.event_id);
    const tiers = await lockTiers(tx, event.id);
    await expireEvent(tx, event.id);
    const purchase = requireValue(
      await one<Purchase>(
        tx,
        'SELECT * FROM tc_purchase WHERE id=$1::uuid FOR UPDATE',
        orderId,
      ),
    );
    assertRule(
      purchase.total === amount && purchase.currency === currency,
      'PAYMENT_MISMATCH',
      'Provider amount or currency does not match',
    );
    const paymentOperation = requireValue(
      await one<{ payment_id: string | null; status: string }>(
        tx,
        "SELECT * FROM tc_provideroperation WHERE order_id=$1::uuid AND kind='payment' FOR UPDATE",
        orderId,
      ),
    );
    if (
      paymentOperation.payment_id &&
      paymentOperation.payment_id !== paymentId
    ) {
      await tx.$executeRawUnsafe(
        `
          INSERT INTO tc_provideroperation(id,order_id,kind,provider,payment_id,data) SELECT $1::uuid,$2::uuid,$3,provider,$4,$5::jsonb
          FROM tc_provideroperation
          WHERE order_id=$2::uuid
          AND kind='payment' ON CONFLICT(order_id,kind) DO NOTHING
        `,
        randomUUID(),
        purchase.id,
        `extra:${paymentId}`,
        paymentId,
        JSON.stringify({ amount: amount.toString(), currency, sender }),
      );
      if (config.SERVICE_NAME === 'booking')
        await publishIntent(
          tx,
          'refund.extra',
          orderId,
          { orderId, paymentId, amount: amount.toString(), currency, sender },
          'payments',
          `extra:${paymentId}`,
        );
      else
        await enqueue(tx, 'extra-refund', `extra:${paymentId}`, {
          orderId,
          paymentId,
        });
      return;
    }
    if (paymentOperation.status === 'captured') return;
    await tx.$executeRawUnsafe(
      "UPDATE tc_provideroperation SET status='captured',payment_id=$2,data=data || $3::jsonb WHERE order_id=$1::uuid AND kind='payment'",
      purchase.id,
      paymentId,
      JSON.stringify({ sender }),
    );
    if (
      event.status !== 'published' ||
      event.starts_at <= event.now ||
      ['refund_pending', 'refunded', 'manual_review'].includes(purchase.status)
    ) {
      await queueRefund(tx, purchase, 'late or closed event');
      return;
    }
    if (purchase.status === 'expired') {
      const items = await rows<{ tier_id: string; quantity: number }>(
        tx,
        'SELECT * FROM tc_purchaseitem WHERE order_id=$1::uuid ORDER BY tier_id',
        purchase.id,
      );
      const canAllocate = await Promise.all(
        items.map(async (item) => {
          const count = requireValue(
            await one<{ count: number }>(
              tx,
              'SELECT count(*)::int AS count FROM tc_inventoryunit i WHERE i.enabled AND tier_id=$1::uuid AND NOT EXISTS(SELECT 1 FROM tc_allocation a WHERE a.unit_id=i.id AND a.active)',
              item.tier_id,
            ),
          );
          return (
            tiers.some(
              (tier) => tier.id === item.tier_id && tier.status === 'active',
            ) && count.count >= item.quantity
          );
        }),
      );
      if (canAllocate.some((v) => !v)) {
        await queueRefund(tx, purchase, 'late payment without stock');
        return;
      }
      for (const item of items)
        await allocate(
          tx,
          purchase.id,
          requireValue(tiers.find((tier) => tier.id === item.tier_id)),
          item.quantity,
        );
    }
    assertRule(
      ['held', 'expired'].includes(purchase.status),
      'ORDER_STATE',
      'Order cannot be fulfilled',
    );
    const allocations = await rows<{ id: string }>(
      tx,
      'SELECT id FROM tc_allocation WHERE order_id=$1::uuid AND active ORDER BY unit_id FOR UPDATE',
      purchase.id,
    );
    for (const allocation of allocations)
      await tx.$executeRawUnsafe(
        'INSERT INTO tc_admissionticket(id,order_id,allocation_id,credential) VALUES($1::uuid,$2::uuid,$3::uuid,$4) ON CONFLICT(allocation_id) DO NOTHING',
        randomUUID(),
        purchase.id,
        allocation.id,
        randomBytes(24).toString('base64url'),
      );
    await tx.$executeRawUnsafe(
      "UPDATE tc_allocation SET state='committed' WHERE order_id=$1::uuid AND active",
      purchase.id,
    );
    await tx.$executeRawUnsafe(
      "UPDATE tc_purchase SET status='paid' WHERE id=$1::uuid",
      purchase.id,
    );
    await tx.$executeRawUnsafe(
      'UPDATE tc_listing SET sale_started=true WHERE id=$1::uuid',
      event.id,
    );
    await notifyEvent(tx, event.id);
    await tx.$executeRawUnsafe(
      'UPDATE tc_tier SET sale_started=true WHERE id IN (SELECT tier_id FROM tc_purchaseitem WHERE order_id=$1::uuid)',
      purchase.id,
    );
  });
}
