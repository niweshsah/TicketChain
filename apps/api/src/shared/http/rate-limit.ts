import { config } from '../config';
import { db, one } from '../db';
import { assertRule, requireValue } from '../errors';
import { redis } from '../infrastructure/redis';

export async function enforceRateLimit(key: string, limit: number) {
  if (config.REDIS_URL) {
    let count: number | undefined;
    try {
      const client = await redis();
      count = Number(
        await client.eval(
          "local n=redis.call('INCR',KEYS[1]);if n==1 then redis.call('EXPIRE',KEYS[1],60) end;return n",
          { keys: [`rate:${key}`], arguments: [] },
        ),
      );
    } catch {
      /* PostgreSQL preserves rate limiting during a cache outage. */
    }
    if (count !== undefined) {
      assertRule(
        count <= limit,
        'RATE_LIMITED',
        'Too many attempts; retry in a minute',
        429,
      );
      return;
    }
  }
  const result = requireValue(
    await one<{ count: number }>(
      db,
      `
        INSERT INTO tc_ratebucket(key,count,expires_at) VALUES($1,1,now()+interval '1 minute') ON CONFLICT(key)
        DO UPDATE SET count=CASE WHEN tc_ratebucket.expires_at<=now() THEN 1 ELSE tc_ratebucket.count+1 END,expires_at=CASE WHEN tc_ratebucket.expires_at<=now() THEN now()+interval '1 minute' ELSE tc_ratebucket.expires_at END
        RETURNING count
      `,
      key,
    ),
  );
  assertRule(
    result.count <= limit,
    'RATE_LIMITED',
    'Too many attempts; retry in a minute',
    429,
  );
}
