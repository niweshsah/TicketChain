import { str, num } from './contracts';
import { type LegacyAnalysis } from './analysis';
import { type Tx } from '../../src/shared/db';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { assertRule } from '../../src/shared/errors';

export async function importOrders(
  tx: Tx,
  { orders, find }: LegacyAnalysis,
  importedEvents: Set<string>,
  importedTiers: Set<string>,
) {
  for (const entry of orders) {
    if (
      !entry.eventId ||
      !importedEvents.has(entry.eventId) ||
      entry.tiers.some((t) => !t || !importedTiers.has(t.id)) ||
      entry.total <= 0n
    )
      continue;
    const { o, items, evidence } = entry;
    await tx.$executeRawUnsafe(
      "INSERT INTO tc_purchase(id,user_id,event_id,idem_key,fingerprint,currency,total,status,expires_at,created_at) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,'INR',$6::bigint,$7,now(),$8::timestamptz)",
      o.id,
      str(o, 'userId'),
      entry.eventId,
      `legacy:${o.id}`,
      createHash('sha256').update(JSON.stringify(o)).digest('hex'),
      entry.total.toString(),
      entry.resolved ? 'paid' : 'manual_review',
      str(o, 'createdAt'),
    );
    for (const tier of new Set(entry.tiers.map((t) => t!.id))) {
      const snapshots = items.filter(
        (i) => find('Ticket', str(i, 'ticketId'))?.ticketTypeId === tier,
      );
      const prices = new Set(snapshots.map((i) => num(i, 'priceCents')));
      assertRule(
        prices.size === 1,
        'SNAPSHOT_AMBIGUOUS',
        'Different historical prices in same tier require manual mapping',
      );
      await tx.$executeRawUnsafe(
        'INSERT INTO tc_purchaseitem(id,order_id,tier_id,tier_name,price,quantity) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5::bigint,$6)',
        snapshots[0].id,
        o.id,
        tier,
        str(find('TicketType', tier)!, 'name'),
        String([...prices][0]),
        snapshots.length,
      );
    }
    for (const item of items) {
      const allocationId = randomUUID();
      await tx.$executeRawUnsafe(
        "INSERT INTO tc_allocation(id,unit_id,order_id,state) VALUES($1::uuid,$2::uuid,$3::uuid,'committed')",
        allocationId,
        str(item, 'ticketId'),
        o.id,
      );
      await tx.$executeRawUnsafe(
        'UPDATE tc_inventoryunit SET enabled=true WHERE id=$1::uuid',
        str(item, 'ticketId'),
      );
      await tx.$executeRawUnsafe(
        'INSERT INTO tc_admissionticket(id,order_id,allocation_id,credential,status) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5)',
        str(item, 'ticketId'),
        o.id,
        allocationId,
        randomBytes(24).toString('base64url'),
        entry.resolved ? 'valid' : 'blocked',
      );
    }
    if (entry.resolved && evidence) {
      await tx.$executeRawUnsafe(
        "INSERT INTO tc_provideroperation(id,order_id,kind,provider,status,payment_id,data) VALUES($1::uuid,$2::uuid,'payment',$3,'captured',$4,$5::jsonb)",
        randomUUID(),
        o.id,
        evidence.provider,
        evidence.paymentId,
        JSON.stringify(evidence),
      );
      await tx.$executeRawUnsafe(
        'UPDATE tc_listing SET sale_started=true WHERE id=$1::uuid',
        entry.eventId,
      );
      await tx.$executeRawUnsafe(
        'UPDATE tc_tier SET sale_started=true WHERE id IN (SELECT tier_id FROM tc_purchaseitem WHERE order_id=$1::uuid)',
        o.id,
      );
    }
  }
}
