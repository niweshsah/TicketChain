import { demoEventIds } from './demo-details';
import 'dotenv/config';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { roles } from './bootstrap/ownership';
import { createSchema } from './bootstrap/service-schema';
import { ensureSigningKeys } from './bootstrap/signing-keys';
import { Client } from 'pg';

const action = process.argv[2] || 'dry-run';
const sourceUrl = process.env.SOURCE_DATABASE_URL || process.env.DATABASE_URL;
if (!sourceUrl) throw new Error('SOURCE_DATABASE_URL is required');
const sourceName = new URL(sourceUrl).pathname.slice(1);
if (!/^[a-z0-9_]+$/.test(sourceName))
  throw new Error('Unsupported database identifier');
const source = new Client({ connectionString: sourceUrl });
const root = resolve(
  __dirname,
  __dirname.endsWith('/dist/scripts') ? '../../../..' : '../../..',
);

async function main() {
  await source.connect();
  const report: Record<string, unknown> = {
    source: sourceName,
    action,
    services: {},
  };
  const sourceTables = (
    await source.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'tc_%'",
    )
  ).rows.map((row) => String(row.tablename));
  const snapshot: Record<string, unknown[]> = {};
  for (const table of sourceTables)
    snapshot[table] = (await source.query(`SELECT * FROM ${table}`)).rows;
  if (action === 'dry-run') {
    for (const [service, tables] of Object.entries(roles))
      (report.services as Record<string, unknown>)[service] =
        Object.fromEntries(
          tables.map((table) => [table, snapshot[table]?.length || 0]),
        );
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  if (!['import', 'verify'].includes(action))
    throw new Error('Use dry-run, import, or verify');
  if (action === 'import') {
    const directory =
      process.env.BACKUP_DIRECTORY || resolve(root, '.runtime/backups');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const backup = resolve(directory, `${sourceName}-${Date.now()}.json`);
    writeFileSync(backup, JSON.stringify(snapshot), { mode: 0o600 });
    console.log(
      JSON.stringify({ event: 'source_backup_created', path: backup }),
    );
  }
  for (const [service, tables] of Object.entries(roles) as [
    keyof typeof roles,
    string[],
  ][]) {
    const database = `${sourceName}_${service}`;
    const username = `tc_${service}`;
    const password =
      process.env[`DATABASE_PASSWORD_${service.toUpperCase()}`] ||
      `local-${service}-replace-before-production`;
    if (!/^[a-zA-Z0-9_-]+$/.test(password))
      throw new Error(
        'Database password must contain letters, numbers, underscores or hyphens',
      );
    if (action === 'import') {
      if (
        !(
          await source.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [
            username,
          ])
        ).rowCount
      )
        await source.query(
          `CREATE ROLE ${username} LOGIN PASSWORD '${password}'`,
        );
      if (
        !(
          await source.query('SELECT 1 FROM pg_database WHERE datname=$1', [
            database,
          ])
        ).rowCount
      )
        await source.query(`CREATE DATABASE ${database} OWNER ${username}`);
      await source.query(`REVOKE CONNECT ON DATABASE ${database} FROM PUBLIC`);
      await source.query(
        `GRANT CONNECT ON DATABASE ${database} TO ${username}`,
      );
    }
    const targetUrl = new URL(sourceUrl!);
    targetUrl.pathname = `/${database}`;
    targetUrl.username = username;
    targetUrl.password = password;
    const target = new Client({ connectionString: targetUrl.toString() });
    await target.connect();
    try {
      if (action === 'import') {
        await target.query('BEGIN');
        await createSchema(target, service, root);
        // Transfer dependencies before dependent records, preserving every original identifier.
        const counts: number[] = [];
        for (const table of tables)
          counts.push(
            (await target.query(`SELECT count(*)::int AS count FROM ${table}`))
              .rows[0].count,
          );
        const empty = counts.every((count) => count === 0);
        if (empty)
          for (const table of tables) {
            const columns = (
              await target.query(
                "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position",
                [table],
              )
            ).rows.map((row) => String(row.column_name));
            for (const original of snapshot[table] || []) {
              const row = { ...(original as Record<string, unknown>) };
              if (service === 'booking' && table === 'tc_account')
                row.password_hash = null;
              if (table === 'tc_job') {
                const financial = [
                  'initialize',
                  'reconcile',
                  'demo-capture',
                  'refund',
                  'extra-refund',
                  'webhook',
                ].includes(String(row.kind));
                if ((service === 'payments') !== financial) continue;
                if (['running', 'queued'].includes(String(row.status))) {
                  row.status = 'ready';
                  row.lease_until = null;
                  row.lease_owner = null;
                }
              }
              if (table === 'tc_listing') row.waiting_room ||= false;
              const keys = columns.filter((column) => column in row);
              await target.query(
                `INSERT INTO ${table}(${keys.map((key) => `"${key}"`).join(',')}) VALUES(${keys.map((_, index) => `$${index + 1}`).join(',')}) ON CONFLICT DO NOTHING`,
                keys.map((key) => row[key]),
              );
            }
          }
        if (service === 'booking') {
          await target.query(
            "UPDATE tc_listing SET performers=COALESCE(performers,ARRAY['Fictional Demo Ensemble']),venue_address=COALESCE(venue_address,'Fictional Central Road, demonstration venue'),languages=COALESCE(languages,ARRAY['English','Hindi']),age_policy=COALESCE(age_policy,'All ages') WHERE id::text=ANY($1::text[])",
            [demoEventIds],
          );
        }
        if (service === 'booking')
          await target.query(
            "INSERT INTO tc_aggregateversion(id,version) SELECT 'event.refresh:'||id,1 FROM tc_listing ON CONFLICT DO NOTHING",
          );
        await target.query('COMMIT');
        console.log(JSON.stringify({ service, imported: empty, database }));
      }
      const counts: Record<string, number> = {};
      for (const table of tables)
        counts[table] = (
          await target.query(`SELECT count(*)::int AS count FROM ${table}`)
        ).rows[0].count;
      if (action === 'verify')
        for (const table of tables.filter(
          (value) =>
            !['tc_job', 'tc_ratebucket', 'tc_catalogevent'].includes(value),
        )) {
          const originals =
            (snapshot[table] as Record<string, unknown>[]) || [];
          if (!originals.length) continue;
          const primary = table === 'tc_oauthattempt' ? 'state_hash' : 'id';
          const identifiers = originals.map((row) => String(row[primary]));
          const preserved = await target.query(
            `SELECT count(*)::int AS count FROM ${table} WHERE ${primary}::text=ANY($1::text[])`,
            [identifiers],
          );
          if (preserved.rows[0].count !== identifiers.length)
            throw new Error(
              `Missing original identifiers in ${service}.${table}`,
            );
        }
      if (service === 'booking') {
        const invalid = await target.query(
          'SELECT unit_id FROM tc_allocation WHERE active GROUP BY unit_id HAVING count(*)>1',
        );
        if (invalid.rowCount) throw new Error('Inventory invariant failed');
        for (const table of [
          'tc_listing',
          'tc_inventoryunit',
          'tc_purchase',
          'tc_admissionticket',
        ])
          if (counts[table] < (snapshot[table]?.length || 0))
            throw new Error(`Missing source records: ${table}`);
      }
      (report.services as Record<string, unknown>)[service] = counts;
    } finally {
      await target.end();
    }
  }
  if (action === 'import') ensureSigningKeys(root);
  console.log(JSON.stringify(report, null, 2));
}
void main().finally(() => source.end());
