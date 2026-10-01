import { discoverySchema } from '@ticketchain/shared';
import { db, one, rows, type Tx } from '../../../shared/db';
import { requireValue } from '../../../shared/errors';
import { publishIntent } from '../../../shared/infrastructure/messages';
import { type Listing, type Tier } from '../../../shared/types';

export async function eventDetails(id: string, owner?: string) {
  const event = requireValue(
    await one<Listing>(
      db,
      "SELECT * FROM tc_listing WHERE id=$1::uuid AND (status='published' OR owner_id=$2::uuid)",
      id,
      owner || null,
    ),
  );
  const tiers = await rows<Tier & { available: number }>(
    db,
    `
      SELECT t.*, (SELECT count(*)::int
      FROM tc_inventoryunit i
      WHERE i.enabled
      AND i.tier_id=t.id
      AND NOT EXISTS(SELECT 1
      FROM tc_allocation a
      JOIN tc_purchase p ON p.id=a.order_id
      WHERE a.unit_id=i.id
      AND a.active
      AND (a.state='committed'
      OR p.expires_at>now()))) AS available
      FROM tc_tier t
      WHERE t.event_id=$1::uuid
      ORDER BY t.id
    `,
    id,
  );
  return {
    ...event,
    tiers: tiers.filter((tier) => tier.status === 'active'),
    ...(owner === event.owner_id
      ? { retired_tiers: tiers.filter((tier) => tier.status === 'retired') }
      : {}),
  };
}

export async function notifyEvent(tx: Tx, eventId: string) {
  await publishIntent(tx, 'event.refresh', eventId, { eventId }, 'catalog');
}

export async function discover(rawQuery: unknown) {
  const query = discoverySchema.parse(rawQuery);
  const sort = {
    date: 'starts_at ASC',
    newest: 'created_at DESC',
    title: 'title ASC',
  }[query.sort];
  const result = await rows<Listing>(
    db,
    `SELECT * FROM tc_listing e WHERE status='published' AND starts_at>now() AND (title ILIKE $1 OR description ILIKE $1 OR array_to_string(performers, ' ') ILIKE $1) AND ($2='' OR category=$2) AND ($3='' OR city ILIKE $3) AND ($4::timestamptz IS NULL OR starts_at>=$4::timestamptz) AND ($5::timestamptz IS NULL OR starts_at<=$5::timestamptz) AND ($6::boolean IS DISTINCT FROM true OR EXISTS(SELECT 1 FROM tc_inventoryunit i JOIN tc_tier t ON t.id=i.tier_id WHERE i.enabled AND t.event_id=e.id AND t.status='active' AND NOT EXISTS(SELECT 1 FROM tc_allocation a JOIN tc_purchase p ON p.id=a.order_id WHERE a.unit_id=i.id AND a.active AND (a.state='committed' OR p.expires_at>now())))) ORDER BY ${sort},id ASC LIMIT $7 OFFSET $8`,
    `%${query.q}%`,
    query.category,
    query.city,
    query.from || null,
    query.to || null,
    query.available === 'true',
    query.limit,
    (query.page - 1) * query.limit,
  );
  return {
    events: await Promise.all(result.map((event) => eventDetails(event.id))),
    page: query.page,
    limit: query.limit,
  };
}

export async function lockEvent(tx: Tx, id: string) {
  return requireValue(
    await one<Listing & { now: Date }>(
      tx,
      'SELECT *,now() AS now FROM tc_listing WHERE id=$1::uuid FOR UPDATE',
      id,
    ),
  );
}

export async function lockTiers(tx: Tx, id: string) {
  return rows<Tier>(
    tx,
    'SELECT * FROM tc_tier WHERE event_id=$1::uuid ORDER BY id FOR UPDATE',
    id,
  );
}
