import { randomUUID } from 'node:crypto';
import { rows, type Tx } from '../../../shared/db';
import { assertRule } from '../../../shared/errors';
import { type Tier } from '../../../shared/types';
import { notifyEvent } from '../events/queries';

export async function expireEvent(tx: Tx, eventId: string) {
  await tx.$executeRawUnsafe(
    `
      UPDATE tc_allocation
      SET active=false,state='expired'
      WHERE active
      AND state='held'
      AND order_id IN (SELECT id
      FROM tc_purchase
      WHERE event_id=$1::uuid
      AND expires_at<=now()
      AND status='held')
    `,
    eventId,
  );
  const changed = await tx.$executeRawUnsafe(
    "UPDATE tc_purchase SET status='expired' WHERE event_id=$1::uuid AND expires_at<=now() AND status='held'",
    eventId,
  );
  if (changed) await notifyEvent(tx, eventId);
}

export async function allocate(
  tx: Tx,
  orderId: string,
  tier: Tier,
  quantity: number,
) {
  const units = await rows<{ id: string }>(
    tx,
    `
      SELECT i.id
      FROM tc_inventoryunit i
      WHERE i.enabled
      AND tier_id=$1::uuid
      AND NOT EXISTS(SELECT 1
      FROM tc_allocation a
      WHERE a.unit_id=i.id
      AND a.active)
      ORDER BY i.id FOR UPDATE
      LIMIT $2
    `,
    tier.id,
    quantity,
  );
  assertRule(
    units.length === quantity,
    'SOLD_OUT',
    'Not enough tickets; no tickets were reserved',
  );
  for (const unit of units)
    await tx.$executeRawUnsafe(
      'INSERT INTO tc_allocation(id,unit_id,order_id) VALUES($1::uuid,$2::uuid,$3::uuid)',
      randomUUID(),
      unit.id,
      orderId,
    );
}
