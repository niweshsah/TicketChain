import { db, one } from '../../src/shared/db';
import { assertRule } from '../../src/shared/errors';
import { tableNames, str } from './contracts';
import { type LegacyAnalysis } from './analysis';

export async function verifyLegacy({ dump, list }: LegacyAnalysis) {
  const count = await one<{ count: number }>(
    db,
    'SELECT count(*)::int AS count FROM tc_legacyrecord WHERE source=$1',
    dump.source,
  );
  assertRule(
    count?.count === tableNames.reduce((n, t) => n + list(t).length, 0),
    'VERIFY_FAILED',
    'Archive count differs from export',
  );
  for (const u of list('User')) {
    const imported = await one<{ password_hash: string }>(
      db,
      'SELECT password_hash FROM tc_account WHERE id=$1::uuid',
      u.id,
    );
    assertRule(
      imported?.password_hash === str(u, 'passwordHash'),
      'VERIFY_FAILED',
      'User ID or password hash differs',
    );
  }
  console.log(
    JSON.stringify({
      verified: true,
      source: dump.source,
      records: count?.count,
    }),
  );
}
