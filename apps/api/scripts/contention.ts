import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { cpus, platform, arch, totalmem } from 'node:os';
import { writeFileSync, mkdirSync } from 'node:fs';
import { register } from '../src/services/identity/auth';
import { saveEvent } from '../src/services/booking/events/editor';
import { transitionEvent } from '../src/services/booking/events/lifecycle';
import { createOrder } from '../src/services/booking/orders/reservations';
import { db, one } from '../src/shared/db';
import { config } from '../src/shared/config';
import { type Account } from '../src/shared/types';
async function main() {
  if (!new URL(config.DATABASE_URL).pathname.endsWith('_test'))
    throw new Error('Contention uses a disposable *_test database only');
  const concurrency = Number(process.env.CONCURRENCY || 40);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 500)
    throw new Error('CONCURRENCY must be 1–500');
  const inventory = 10;
  const s = await register({
    name: 'Contention organizer',
    email: `${randomUUID()}@test.local`,
    password: 'ContentionPassword!1',
    role: 'organizer',
  });
  const user = (await one<Account>(
    db,
    'SELECT * FROM tc_account WHERE id=$1::uuid',
    s.user.id,
  ))!;
  const event = await saveEvent(user, {
    title: 'Disposable contention event',
    description: 'Ten units under concurrent booking pressure',
    category: 'Concert',
    venue: 'Test hall',
    city: 'Test city',
    timezone: 'UTC',
    imageUrl: 'https://example.com/test.jpg',
    startsAt: new Date(Date.now() + 86400000).toISOString(),
    endsAt: new Date(Date.now() + 90000000).toISOString(),
    tiers: [{ name: 'General', pricePaise: 10000, quantity: inventory }],
  });
  await transitionEvent(user, event.id, 'publish');
  const latencies: number[] = [];
  const start = performance.now();
  const results = await Promise.allSettled(
    Array.from({ length: concurrency }, async () => {
      const began = performance.now();
      try {
        return await createOrder(
          user,
          {
            eventId: event.id,
            items: [{ tierId: event.tiers[0].id, quantity: 1 }],
          },
          randomUUID(),
        );
      } finally {
        latencies.push(performance.now() - began);
      }
    }),
  );
  latencies.sort((a, b) => a - b);
  const success = results.filter((r) => r.status === 'fulfilled').length;
  const conflicts = results.filter(
    (r) => r.status === 'rejected' && r.reason.code === 'SOLD_OUT',
  ).length;
  const allocated = (await one<{ count: number }>(
    db,
    'SELECT count(*)::int AS count FROM tc_allocation a JOIN tc_purchase p ON p.id=a.order_id WHERE p.event_id=$1::uuid AND a.active',
    event.id,
  ))!.count;
  const report = {
    measuredAt: new Date().toISOString(),
    hardware: {
      cpu: cpus()[0]?.model,
      cores: cpus().length,
      memoryBytes: totalmem(),
      platform: platform(),
      arch: arch(),
    },
    dataset: { eventId: event.id, tiers: 1, inventory },
    concurrency,
    durationMs: performance.now() - start,
    outcomes: {
      success,
      conflicts,
      otherFailures: concurrency - success - conflicts,
      allocated,
    },
    latencyMs: {
      p50: latencies[Math.floor(latencies.length * 0.5)],
      p95: latencies[
        Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))
      ],
      max: latencies.at(-1),
    },
    zeroOverselling: allocated <= inventory,
  };
  mkdirSync(
    dirname(process.env.CONTENTION_REPORT || 'artifacts/contention.json'),
    { recursive: true },
  );
  writeFileSync(
    process.env.CONTENTION_REPORT || 'artifacts/contention.json',
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(JSON.stringify(report, null, 2));
  if (
    success !== Math.min(inventory, concurrency) ||
    allocated !== success ||
    conflicts !== concurrency - success
  )
    throw new Error('Contention invariant failed');
}
void main().finally(() => db.$disconnect());
