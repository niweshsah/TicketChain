import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';

const database = process.env.TEST_DATABASE_URL;
if (!database || !new URL(database).pathname.endsWith('_test'))
  throw new Error('Use a separate *_test database');
process.env.DATABASE_URL = database;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= 'isolated-queue-tests-secret-at-least-32';
let db: typeof import('../../apps/api/src/shared/db');
beforeAll(async () => {
  db = await import('../../apps/api/src/shared/db');
});
afterAll(async () => {
  await db.db.$disconnect();
  vi.restoreAllMocks();
});

it('commits domain changes and messages together, rolls back failures, and deduplicates intent', async () => {
  const config = (await import('../../apps/api/src/shared/config')).config;
  const original = config.SERVICE_NAME;
  config.SERVICE_NAME = 'booking';
  const { publishIntent } =
    await import('../../apps/api/src/shared/infrastructure/messages');
  const id = randomUUID();
  try {
    await expect(
      db.transaction(async (tx) => {
        await publishIntent(
          tx,
          'test.atomic',
          id,
          { orderId: id },
          'payments',
          id,
        );
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(
      await db.one(db.db, 'SELECT id FROM tc_outbox WHERE dedupe=$1', id),
    ).toBeUndefined();
    await db.transaction(async (tx) => {
      await publishIntent(
        tx,
        'test.atomic',
        id,
        { orderId: id },
        'payments',
        id,
      );
      await publishIntent(
        tx,
        'test.atomic',
        id,
        { orderId: id },
        'payments',
        id,
      );
    });
    const messages = await db.rows<{
      message: { id: string; aggregateId: string; schemaVersion: number };
    }>(db.db, 'SELECT message FROM tc_outbox WHERE dedupe=$1', id);
    expect(messages).toHaveLength(1);
    expect(messages[0].message).toMatchObject({
      aggregateId: id,
      schemaVersion: 1,
    });
  } finally {
    config.SERVICE_NAME = original;
  }
});

describe.skipIf(!process.env.REDIS_URL)('real Redis waiting room', () => {
  it('admits FIFO, bounds admission, prevents duplicate membership and pass replay, and expires passes', async () => {
    const { waitingRoom, consumePass } =
      await import('../../apps/api/src/services/booking/waiting-room');
    const { redis, closeRedis } =
      await import('../../apps/api/src/shared/infrastructure/redis');
    const eventId = randomUUID(),
      users = Array.from({ length: 55 }, () => randomUUID());
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    try {
      const states = [];
      for (const user of users)
        states.push(await waitingRoom(eventId, user, 'join'));
      expect(
        states.slice(0, 10).every((state) => state.state === 'admitted'),
      ).toBe(true);
      expect(states[10]).toMatchObject({ state: 'waiting', position: 1 });
      expect(states[54]).toMatchObject({ state: 'waiting', position: 45 });
      expect(await waitingRoom(eventId, users[54], 'join')).toMatchObject({
        position: 45,
      });
      await consumePass(eventId, users[0], states[0].pass, 'same-request');
      await consumePass(eventId, users[0], states[0].pass, 'same-request');
      await expect(
        consumePass(eventId, users[0], states[0].pass, 'different-request'),
      ).rejects.toMatchObject({ code: 'ADMISSION_PASS_EXPIRED' });
      clock.mockReturnValue(now + 1000);
      expect(await waitingRoom(eventId, users[10], 'status')).toMatchObject({
        state: 'admitted',
      });
      clock.mockReturnValue(now + 121000);
      await expect(
        consumePass(eventId, users[1], states[1].pass, 'expired-request'),
      ).rejects.toMatchObject({ code: 'ADMISSION_PASS_EXPIRED' });
      expect(await waitingRoom(eventId, users[1], 'status')).toMatchObject({
        state: 'not_joined',
      });
      const client = await redis();
      const keys = await client.keys(`room:${eventId}:*`);
      if (keys.length) await client.del(keys);
    } finally {
      clock.mockRestore();
      await closeRedis();
    }
  });
});
