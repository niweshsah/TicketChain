import { randomUUID } from 'node:crypto';
import { config } from '../../../shared/config';
import { one, transaction, type Tx } from '../../../shared/db';
import { assertRule, requireValue } from '../../../shared/errors';
import { enqueue } from '../../../shared/infrastructure/jobs';
import { publishIntent } from '../../../shared/infrastructure/messages';
import { type Account, type Purchase } from '../../../shared/types';
import { notifyEvent, lockEvent, lockTiers } from '../events/queries';
import { orderDetails } from './queries';

export async function queueRefund(tx: Tx, order: Purchase, reason: string) {
  if (['refunded', 'refund_pending', 'manual_review'].includes(order.status))
    return;
  const used = await one(
    tx,
    'SELECT id FROM tc_admissionticket WHERE order_id=$1::uuid AND checked_at IS NOT NULL LIMIT 1',
    order.id,
  );
  if (used) {
    await tx.$executeRawUnsafe(
      "UPDATE tc_purchase SET status='manual_review' WHERE id=$1::uuid",
      order.id,
    );
    await tx.$executeRawUnsafe(
      "UPDATE tc_admissionticket SET status='blocked' WHERE order_id=$1::uuid",
      order.id,
    );
    return;
  }
  await tx.$executeRawUnsafe(
    "UPDATE tc_purchase SET status='refund_pending' WHERE id=$1::uuid",
    order.id,
  );
  await tx.$executeRawUnsafe(
    "UPDATE tc_admissionticket SET status='blocked' WHERE order_id=$1::uuid",
    order.id,
  );
  await tx.$executeRawUnsafe(
    `
      INSERT INTO tc_provideroperation(id,order_id,kind,provider,data) SELECT $1::uuid,$2::uuid,'refund',provider,$3::jsonb
      FROM tc_provideroperation
      WHERE order_id=$2::uuid
      AND kind='payment' ON CONFLICT(order_id,kind) DO NOTHING
    `,
    randomUUID(),
    order.id,
    JSON.stringify({ reason }),
  );
  if (config.SERVICE_NAME === 'booking')
    await publishIntent(
      tx,
      'refund.requested',
      order.id,
      { orderId: order.id, reason },
      'payments',
      `refund:${order.id}`,
    );
  else await enqueue(tx, 'refund', `refund:${order.id}`, { orderId: order.id });
}

export async function requestRefund(user: Account, orderId: string) {
  await transaction(async (tx) => {
    const purchaseReference = requireValue(
      await one<Purchase>(
        tx,
        'SELECT * FROM tc_purchase WHERE id=$1::uuid AND user_id=$2::uuid',
        orderId,
        user.id,
      ),
    );
    const event = await lockEvent(tx, purchaseReference.event_id);
    await lockTiers(tx, event.id);
    const purchase = requireValue(
      await one<Purchase>(
        tx,
        'SELECT * FROM tc_purchase WHERE id=$1::uuid FOR UPDATE',
        orderId,
      ),
    );
    if (['refund_pending', 'refunded'].includes(purchase.status)) return;
    assertRule(
      purchase.status === 'paid',
      'NOT_PAID',
      'Only paid orders can be refunded',
    );
    assertRule(
      event.starts_at > event.now,
      'REFUND_CLOSED',
      'Attendee refunds close at event start',
    );
    assertRule(
      !(await one(
        tx,
        'SELECT id FROM tc_admissionticket WHERE order_id=$1::uuid AND checked_at IS NOT NULL',
        purchase.id,
      )),
      'ALREADY_USED',
      'A checked-in order cannot be refunded',
    );
    await queueRefund(tx, purchase, 'attendee');
  });
  return orderDetails(user.id, orderId);
}

export async function finishRefund(orderId: string) {
  await transaction(async (tx) => {
    const purchaseReference = requireValue(
      await one<Purchase>(
        tx,
        'SELECT * FROM tc_purchase WHERE id=$1::uuid',
        orderId,
      ),
    );
    const event = await lockEvent(tx, purchaseReference.event_id);
    await lockTiers(tx, event.id);
    const purchase = requireValue(
      await one<Purchase>(
        tx,
        'SELECT * FROM tc_purchase WHERE id=$1::uuid FOR UPDATE',
        orderId,
      ),
    );
    if (purchase.status === 'refunded') return;
    assertRule(
      purchase.status === 'refund_pending',
      'REFUND_STATE',
      'Refund state needs review',
    );
    await tx.$executeRawUnsafe(
      "UPDATE tc_purchase SET status='refunded' WHERE id=$1::uuid",
      orderId,
    );
    await tx.$executeRawUnsafe(
      "UPDATE tc_admissionticket SET status='refunded' WHERE order_id=$1::uuid",
      orderId,
    );
    if (event.status === 'published' && event.starts_at > event.now)
      await tx.$executeRawUnsafe(
        "UPDATE tc_allocation SET active=false,state='refunded' WHERE order_id=$1::uuid AND active",
        orderId,
      );
    await tx.$executeRawUnsafe(
      "UPDATE tc_provideroperation SET status='confirmed' WHERE order_id=$1::uuid AND kind='refund'",
      orderId,
    );
    await notifyEvent(tx, event.id);
  });
}
