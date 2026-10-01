import type { Client } from 'pg';
import { connectService, connectSource, inTransaction } from './database';

type EventRow = {
  id: string;
  owner_id: string;
  title: string;
  status: string;
};

async function event(client: Client, id: string) {
  const result = await client.query<EventRow>(
    'SELECT id,owner_id,title,status FROM tc_listing WHERE id=$1::uuid',
    [id],
  );
  return result.rows[0];
}

async function counts(client: Client, id: string) {
  const result = await client.query<{
    tiers: number;
    inventory: number;
    purchases: number;
    allocations: number;
    admissions: number;
    claims: number;
  }>(
    `SELECT
      (SELECT count(*)::int FROM tc_tier WHERE event_id=$1::uuid) AS tiers,
      (SELECT count(*)::int FROM tc_inventoryunit i JOIN tc_tier t ON t.id=i.tier_id WHERE t.event_id=$1::uuid) AS inventory,
      (SELECT count(*)::int FROM tc_purchase WHERE event_id=$1::uuid) AS purchases,
      (SELECT count(*)::int FROM tc_allocation a JOIN tc_inventoryunit i ON i.id=a.unit_id JOIN tc_tier t ON t.id=i.tier_id WHERE t.event_id=$1::uuid) AS allocations,
      (SELECT count(*)::int FROM tc_admissionticket a JOIN tc_purchase p ON p.id=a.order_id WHERE p.event_id=$1::uuid) AS admissions,
      (SELECT count(*)::int FROM tc_claim c JOIN tc_admissionticket a ON a.id=c.ticket_id JOIN tc_purchase p ON p.id=a.order_id WHERE p.event_id=$1::uuid) AS claims`,
    [id],
  );
  return result.rows[0];
}

export async function previewEvent(id: string, ownerId?: string) {
  const [booking, source, catalog] = await Promise.all([
    connectService('booking'),
    connectSource(),
    connectService('catalog'),
  ]);
  try {
    const [bookingEvent, sourceEvent, catalogRow] = await Promise.all([
      event(booking, id),
      event(source, id),
      catalog.query('SELECT id FROM tc_catalogevent WHERE id=$1::uuid', [id]),
    ]);
    const childCounts = bookingEvent ? await counts(booking, id) : undefined;
    return {
      id,
      bookingEvent: bookingEvent && {
        title: bookingEvent.title,
        status: bookingEvent.status,
        ownedBySelectedUser: ownerId
          ? bookingEvent.owner_id === ownerId
          : undefined,
      },
      sourceEvent: Boolean(sourceEvent),
      catalogProjection: Boolean(catalogRow.rowCount),
      ...childCounts,
    };
  } finally {
    await Promise.all([booking.end(), source.end(), catalog.end()]);
  }
}

export async function assertEventRemovable(id: string, ownerId?: string) {
  const searchUrl = process.env.ELASTICSEARCH_URL || 'http://localhost:9200';
  const health = await fetch(`${searchUrl}/_cluster/health`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!health.ok) throw new Error('Elasticsearch is unavailable');
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error('Set REDIS_URL before event cleanup');
  const { createClient } = await import('redis');
  const redis = createClient({ url: redisUrl });
  redis.on('error', () => undefined);
  try {
    await redis.connect();
    await redis.ping();
  } finally {
    redis.destroy();
  }
  const [booking, source, catalog] = await Promise.all([
    connectService('booking'),
    connectSource(),
    connectService('catalog'),
  ]);
  try {
    let found = false;
    for (const client of [booking, source]) {
      const listing = await event(client, id);
      if (!listing) continue;
      found = true;
      if (ownerId && listing.owner_id !== ownerId)
        throw new Error(`Event ${id} is not owned by the selected account`);
      if (listing.status !== 'cancelled')
        throw new Error(`Event ${id} must be cancelled before removal`);
      const childCounts = await counts(client, id);
      if (
        childCounts.purchases ||
        childCounts.allocations ||
        childCounts.admissions ||
        childCounts.claims
      )
        throw new Error(
          `Event ${id} has purchase or ticket history; refusing to remove it`,
        );
    }
    if (!found) {
      const projection = await catalog.query<{ owner_id: string }>(
        `SELECT document->>'owner_id' AS owner_id FROM tc_catalogevent
         WHERE id=$1::uuid`,
        [id],
      );
      if (!projection.rowCount) return;
      if (ownerId && projection.rows[0].owner_id !== ownerId)
        throw new Error(`Event ${id} is not owned by the selected account`);
    }

    for (const client of [booking, source]) {
      const messages = await client.query<{
        id: string;
        published_at: Date | null;
      }>(
        `SELECT id,published_at FROM tc_outbox
         WHERE destination='catalog' AND message->>'aggregateId'=$1`,
        [id],
      );
      if (messages.rows.some((message) => !message.published_at))
        throw new Error(
          `Event ${id} has pending Catalog messages; retry after workers drain`,
        );
      const ids = messages.rows.map((message) => message.id);
      if (ids.length) {
        const acknowledged = await catalog.query<{ message_id: string }>(
          `SELECT message_id FROM tc_inbox WHERE consumer='catalog' AND message_id=ANY($1::uuid[])`,
          [ids],
        );
        if (acknowledged.rowCount !== ids.length)
          throw new Error(
            `Catalog has not acknowledged all changes for event ${id}`,
          );
      }
    }
  } finally {
    await Promise.all([booking.end(), source.end(), catalog.end()]);
  }
}

async function removeEvent(client: Client, id: string, ownerId?: string) {
  return inTransaction(client, async () => {
    const result = await client.query<EventRow>(
      'SELECT id,owner_id,title,status FROM tc_listing WHERE id=$1::uuid FOR UPDATE',
      [id],
    );
    const listing = result.rows[0];
    if (!listing) return false;
    if (ownerId && listing.owner_id !== ownerId)
      throw new Error(`Event ${id} is not owned by the selected account`);
    if (listing.status !== 'cancelled')
      throw new Error(`Event ${id} must be cancelled before removal`);
    const childCounts = await counts(client, id);
    if (
      childCounts.purchases ||
      childCounts.allocations ||
      childCounts.admissions ||
      childCounts.claims
    )
      throw new Error(
        `Event ${id} has purchase or ticket history; refusing to remove it`,
      );
    const pending = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM tc_outbox
       WHERE destination='catalog' AND published_at IS NULL
         AND message->>'aggregateId'=$1`,
      [id],
    );
    if (pending.rows[0].count)
      throw new Error(
        `Event ${id} has pending Catalog messages; retry after workers drain`,
      );
    await client.query(
      'DELETE FROM tc_inventoryunit WHERE tier_id IN (SELECT id FROM tc_tier WHERE event_id=$1::uuid)',
      [id],
    );
    await client.query('DELETE FROM tc_tier WHERE event_id=$1::uuid', [id]);
    await client.query('DELETE FROM tc_listing WHERE id=$1::uuid', [id]);
    await client.query('DELETE FROM tc_aggregateversion WHERE id=$1', [
      `event.refresh:${id}`,
    ]);
    return true;
  });
}

async function removeProjection(id: string) {
  const catalog = await connectService('catalog');
  try {
    await catalog.query('DELETE FROM tc_catalogevent WHERE id=$1::uuid', [id]);
  } finally {
    await catalog.end();
  }
  const searchUrl = process.env.ELASTICSEARCH_URL || 'http://localhost:9200';
  const response = await fetch(
    `${searchUrl}/ticketchain-events-v1/_doc/${id}`,
    { method: 'DELETE', signal: AbortSignal.timeout(5000) },
  );
  if (!response.ok && response.status !== 404)
    throw new Error(`Search index cleanup failed (${response.status})`);
  const cacheUrl = process.env.REDIS_URL;
  if (cacheUrl) {
    const { createClient } = await import('redis');
    const redis = createClient({ url: cacheUrl });
    redis.on('error', () => undefined);
    try {
      await redis.connect();
      await redis.incr('catalog:epoch');
    } finally {
      redis.destroy();
    }
  }
}

export async function deleteEvent(id: string, ownerId?: string) {
  await assertEventRemovable(id, ownerId);
  const [booking, source, catalog] = await Promise.all([
    connectService('booking'),
    connectSource(),
    connectService('catalog'),
  ]);
  try {
    await removeEvent(booking, id, ownerId);
    await removeEvent(source, id, ownerId);
  } finally {
    await Promise.all([booking.end(), source.end(), catalog.end()]);
  }
  await removeProjection(id);
}
