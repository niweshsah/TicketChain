import {
  orderSchema,
  canonicalOrder,
  type OrderInput,
} from '@ticketchain/shared';
import { randomUUID } from 'node:crypto';
import { config } from '../../../shared/config';
import { hash } from '../../../shared/crypto';
import { db, one, transaction } from '../../../shared/db';
import { assertRule, requireValue } from '../../../shared/errors';
import { enqueue } from '../../../shared/infrastructure/jobs';
import { type Account, type Purchase } from '../../../shared/types';
import { notifyEvent, lockEvent, lockTiers } from '../events/queries';
import { consumePass } from '../waiting-room';
import { expireEvent, allocate } from './inventory';
import { orderDetails } from './queries';

export async function createOrder(
  user: Account,
  body: unknown,
  idemKey: string,
) {
  const input = orderSchema.parse(body);
  assertRule(
    idemKey.length >= 8 && idemKey.length <= 128,
    'IDEMPOTENCY_REQUIRED',
    'Use an 8–128 character Idempotency-Key',
    400,
  );
  const fingerprint = hash(canonicalOrder(input));
  const existingOrder = await one<Purchase>(
    db,
    'SELECT * FROM tc_purchase WHERE user_id=$1::uuid AND idem_key=$2',
    user.id,
    idemKey,
  );
  if (existingOrder) {
    assertRule(
      existingOrder.fingerprint === fingerprint,
      'IDEMPOTENCY_MISMATCH',
      'Key was used with different order details',
    );
    return orderDetails(user.id, existingOrder.id);
  }
  const listing = requireValue(
    await one<{ waiting_room: boolean }>(
      db,
      'SELECT waiting_room FROM tc_listing WHERE id=$1::uuid',
      input.eventId,
    ),
  );
  if (listing.waiting_room)
    await consumePass(input.eventId, user.id, input.admissionPass, idemKey);
  const orderId = await transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
      `${user.id}:${idemKey}`,
    );
    const prior = await one<Purchase>(
      tx,
      'SELECT * FROM tc_purchase WHERE user_id=$1::uuid AND idem_key=$2',
      user.id,
      idemKey,
    );
    if (prior) {
      assertRule(
        prior.fingerprint === fingerprint,
        'IDEMPOTENCY_MISMATCH',
        'Key was used with different order details',
      );
      return prior.id;
    }
    const event = await lockEvent(tx, input.eventId);
    const tiers = await lockTiers(tx, event.id);
    assertRule(
      !event.waiting_room || listing.waiting_room,
      'WAITING_ROOM_REQUIRED',
      'The organizer enabled a waiting room. Join it before reserving.',
    );
    assertRule(
      event.status === 'published' && event.starts_at > event.now,
      'SALES_CLOSED',
      'Checkout has closed',
    );
    if (input.currency === 'APT')
      assertRule(
        user.wallet && config.APTOS_TREASURY,
        'APT_UNAVAILABLE',
        'Link a verified wallet and configure a treasury before APT checkout',
      );
    await expireEvent(tx, event.id);
    const priced = input.items.map((item) => {
      const tier = requireValue(
        tiers.find(
          (tier) => tier.id === item.tierId && tier.status === 'active',
        ),
        'TIER_INVALID',
      );
      const price =
        input.currency === 'INR' ? BigInt(tier.price_paise) : tier.price_octas;
      assertRule(
        price && price > 0n,
        'PRICE_UNAVAILABLE',
        'This tier has no explicit APT price',
      );
      return { ...item, t: tier, price };
    });
    const total = priced.reduce(
      (n, item) => n + item.price * BigInt(item.quantity),
      0n,
    );
    assertRule(
      total <= 9223372036854775807n,
      'TOTAL_TOO_LARGE',
      'Order total exceeds supported bigint range',
      400,
    );
    const id = randomUUID();
    await tx.$executeRawUnsafe(
      "INSERT INTO tc_purchase(id,user_id,event_id,idem_key,fingerprint,currency,total,expires_at) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7::bigint,now()+interval '10 minutes')",
      id,
      user.id,
      event.id,
      idemKey,
      fingerprint,
      input.currency,
      total.toString(),
    );
    for (const item of priced) {
      await allocate(tx, id, item.t, item.quantity);
      await tx.$executeRawUnsafe(
        'INSERT INTO tc_purchaseitem(id,order_id,tier_id,tier_name,price,quantity) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5::bigint,$6)',
        randomUUID(),
        id,
        item.t.id,
        item.t.name,
        item.price.toString(),
        item.quantity,
      );
    }
    await enqueue(tx, 'expire', `expire:${id}`, { eventId: event.id }, 600);
    await notifyEvent(tx, event.id);
    return id;
  });
  return orderDetails(user.id, orderId);
}

export function fingerprint(input: OrderInput) {
  return hash(canonicalOrder(input));
}
