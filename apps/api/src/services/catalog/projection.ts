import { type EventDto } from '@ticketchain/shared';
import { config } from '../../shared/config';
import { db, one } from '../../shared/db';
import { type DomainMessage } from '../../shared/infrastructure/messages';
import { redis } from '../../shared/infrastructure/redis';
import { serviceRequest } from '../../shared/service-client';

export const index = 'ticketchain-events-v1';

export async function elastic(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(`${config.ELASTICSEARCH_URL}/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok && response.status !== 409)
    throw new Error('Search index unavailable');
  return response;
}

export async function ensureIndex() {
  const response = await fetch(`${config.ELASTICSEARCH_URL}/${index}`, {
    signal: AbortSignal.timeout(3000),
  });
  if (response.status === 404)
    await elastic(index, 'PUT', {
      mappings: {
        properties: {
          id: { type: 'keyword' },
          title: { type: 'text', fields: { keyword: { type: 'keyword' } } },
          description: { type: 'text' },
          performers: { type: 'text' },
          category: { type: 'keyword' },
          city: { type: 'keyword', normalizer: 'lowercase' },
          status: { type: 'keyword' },
          starts_at: { type: 'date' },
          created_at: { type: 'date' },
          availableTotal: { type: 'integer' },
        },
      },
      settings: {
        number_of_shards: 1,
        number_of_replicas: 0,
        analysis: {
          normalizer: { lowercase: { type: 'custom', filter: ['lowercase'] } },
        },
      },
    });
}

export async function updateProjection(message: DomainMessage, repair = false) {
  const document = await serviceRequest<EventDto>(
    config.BOOKING_URL,
    `/internal/events/${message.aggregateId}`,
  );
  delete document.retired_tiers;
  const changed = await db.$executeRawUnsafe(
    `
      INSERT INTO tc_catalogevent(id,version,document) VALUES($1::uuid,$2::bigint,$3::jsonb) ON CONFLICT(id)
      DO UPDATE SET version=EXCLUDED.version,document=EXCLUDED.document
      WHERE tc_catalogevent.version<EXCLUDED.version
      OR ($4::boolean
      AND tc_catalogevent.version=EXCLUDED.version)
    `,
    document.id,
    message.aggregateVersion,
    JSON.stringify(document),
    repair,
  );
  if (changed) {
    try {
      const client = await redis();
      await client.incr('catalog:epoch');
    } catch {
      /* Cache is optional. */
    }
  }
  const current = await one<{ version: bigint; document: EventDto }>(
    db,
    'SELECT * FROM tc_catalogevent WHERE id=$1::uuid',
    document.id,
  );
  if (current)
    await elastic(
      `${index}/_doc/${document.id}?version=${current.version}&version_type=external_gte`,
      'PUT',
      {
        ...current.document,
        availableTotal: current.document.tiers.reduce(
          (sum, tier) => sum + tier.available,
          0,
        ),
      },
    );
}
