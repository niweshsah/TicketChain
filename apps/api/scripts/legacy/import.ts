import { one, transaction } from '../../src/shared/db';
import { assertRule } from '../../src/shared/errors';
import { tableNames, str } from './contracts';
import { type LegacyAnalysis } from './analysis';
import { importEventsAndInventory } from './events';
import { importOrders } from './orders';

export async function importLegacy(analysis: LegacyAnalysis) {
  const { dump, list, issues } = analysis;
  assertRule(
    process.env.ALLOW_LEGACY_IMPORT === 'yes',
    'IMPORT_DISABLED',
    'Set ALLOW_LEGACY_IMPORT=yes only after reviewing dry-run report and backup',
  );
  assertRule(
    process.env.DATABASE_URL !== process.env.LEGACY_DATABASE_URL,
    'SOURCE_IS_TARGET',
    'Source must remain separate and unchanged',
  );
  await transaction(async (tx) => {
    const imported = await one(
      tx,
      'SELECT key FROM tc_legacyrecord WHERE source=$1 LIMIT 1',
      dump.source,
    );
    assertRule(
      !imported,
      'ALREADY_IMPORTED',
      'Export already imported; use verify',
    );
    for (const table of tableNames)
      for (const r of list(table))
        await tx.$executeRawUnsafe(
          'INSERT INTO tc_legacyrecord(key,source,table_name,record_id,original,reason) VALUES($1,$2,$3,$4,$5::jsonb,$6)',
          `${dump.source}:${table}:${r.id}`,
          dump.source,
          table,
          r.id,
          JSON.stringify(r),
          issues
            .filter((i) => i.table === table && i.id === r.id)
            .map((i) => i.reason)
            .join('; ') || null,
        );
    for (const u of list('User')) {
      const reason = issues.find(
        (i) => i.table === 'User' && i.id === u.id,
      )?.reason;
      await tx.$executeRawUnsafe(
        'INSERT INTO tc_account(id,name,email,password_hash,role,active,inactive_reason,created_at) VALUES($1::uuid,$2,$3,$4,$5,$6,$7,$8::timestamptz)',
        u.id,
        str(u, 'name'),
        str(u, 'email').toLowerCase(),
        str(u, 'passwordHash'),
        str(u, 'role') === 'organizer' ? 'organizer' : 'attendee',
        !reason,
        reason || null,
        str(u, 'createdAt'),
      );
    }
    const importedEvents = await importEventsAndInventory(tx, analysis);
    await importOrders(
      tx,
      analysis,
      importedEvents.events,
      importedEvents.tiers,
    );
  });
}
