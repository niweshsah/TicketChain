import { randomUUID } from 'node:crypto';
import { afterAll, expect, it, vi } from 'vitest';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith('_test'))
  throw new Error('Use an isolated test database');
process.env.DATABASE_URL = databaseUrl;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= 'catalog-test-secret-at-least-32-characters';
const database = await import('../../apps/api/src/shared/db');
const projection =
  await import('../../apps/api/src/services/catalog/projection');
const { searchEvents } =
  await import('../../apps/api/src/services/catalog/search');
afterAll(() => database.db.$disconnect());

it('finds a performer in the Catalog database when Elasticsearch is unavailable', async () => {
  const id = randomUUID();
  const performer = `Review Performer ${randomUUID()}`;
  const document = {
    id,
    title: 'An event with a different title',
    description: 'A fictional discovery fixture',
    performers: [performer],
    status: 'published',
    starts_at: new Date(Date.now() + 86400000).toISOString(),
    created_at: new Date().toISOString(),
    category: 'Concert',
    city: 'Bengaluru',
    tiers: [],
  };
  const searchFailure = vi
    .spyOn(projection, 'elastic')
    .mockRejectedValue(new Error('Search outage'));
  try {
    await database.db.$executeRawUnsafe(
      'INSERT INTO tc_catalogevent(id,version,document) VALUES($1::uuid,1,$2::jsonb)',
      id,
      JSON.stringify(document),
    );
    const result = await searchEvents({ q: performer, city: 'Bengaluru' });
    expect(result.events.map((event) => event.id)).toEqual([id]);
    expect(searchFailure).toHaveBeenCalled();
  } finally {
    searchFailure.mockRestore();
    await database.db.$executeRawUnsafe(
      'DELETE FROM tc_catalogevent WHERE id=$1::uuid',
      id,
    );
  }
});
