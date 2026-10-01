import { discoverySchema, type EventDto } from '@ticketchain/shared';
import { db, rows } from '../../shared/db';
import { redis } from '../../shared/infrastructure/redis';
import { elastic, index } from './projection';

export async function searchEvents(rawQuery: unknown) {
  const query = discoverySchema.parse(rawQuery);
  let cacheKey: string | undefined;
  try {
    const client = await redis();
    cacheKey = `catalog:${(await client.get('catalog:epoch')) || '0'}:${JSON.stringify(query)}`;
    const cached = await client.get(cacheKey);
    if (cached)
      return JSON.parse(cached) as {
        events: EventDto[];
        page: number;
        limit: number;
      };
  } catch {
    /* Search does not require its cache. */
  }
  let events: EventDto[];
  try {
    const filters: unknown[] = [
      { term: { status: 'published' } },
      {
        range: {
          starts_at: {
            gt: 'now',
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        },
      },
    ];
    if (query.category) filters.push({ term: { category: query.category } });
    if (query.city)
      filters.push({
        term: { city: query.city.toLowerCase() },
      });
    if (query.available === 'true')
      filters.push({ range: { availableTotal: { gt: 0 } } });
    const sort =
      query.sort === 'title'
        ? { 'title.keyword': 'asc' }
        : query.sort === 'newest'
          ? { created_at: 'desc' }
          : { starts_at: 'asc' };
    const response = await elastic(`${index}/_search`, 'POST', {
      from: (query.page - 1) * query.limit,
      size: query.limit,
      query: {
        bool: {
          filter: filters,
          ...(query.q
            ? {
                must: [
                  {
                    multi_match: {
                      query: query.q,
                      fields: ['title^3', 'performers^2', 'description'],
                    },
                  },
                ],
              }
            : {}),
        },
      },
      sort: [sort, { id: 'asc' }],
    });
    const result = (await response.json()) as {
      hits: { hits: { _source: EventDto & { availableTotal?: number } }[] };
    };
    events = result.hits.hits.map((hit) => {
      const event = { ...hit._source };
      delete event.availableTotal;
      return event;
    });
  } catch {
    const orderBy = {
      date: "(document->>'starts_at')::timestamptz ASC",
      newest: "(document->>'created_at')::timestamptz DESC",
      title: "document->>'title' ASC",
    }[query.sort];
    const result = await rows<{ document: EventDto }>(
      db,
      `SELECT document FROM tc_catalogevent WHERE document->>'status'='published' AND (document->>'starts_at')::timestamptz>now() AND ((document->>'title') ILIKE $1 OR (document->>'description') ILIKE $1 OR (document->>'performers') ILIKE $1) AND ($2='' OR document->>'category'=$2) AND ($3='' OR document->>'city' ILIKE $3) AND ($4::timestamptz IS NULL OR (document->>'starts_at')::timestamptz>=$4::timestamptz) AND ($5::timestamptz IS NULL OR (document->>'starts_at')::timestamptz<=$5::timestamptz) AND ($6::boolean IS DISTINCT FROM true OR EXISTS(SELECT 1 FROM jsonb_array_elements(document->'tiers') t WHERE (t->>'available')::int>0)) ORDER BY ${orderBy},id ASC LIMIT $7 OFFSET $8`,
      `%${query.q}%`,
      query.category,
      query.city,
      query.from || null,
      query.to || null,
      query.available === 'true',
      query.limit,
      (query.page - 1) * query.limit,
    );
    events = result.map((item) => item.document);
  }
  const result = { events, page: query.page, limit: query.limit };
  if (cacheKey) {
    try {
      const client = await redis();
      await client.set(cacheKey, JSON.stringify(result), { EX: 10 });
    } catch {
      /* Cache failure cannot block discovery. */
    }
  }
  return result;
}
