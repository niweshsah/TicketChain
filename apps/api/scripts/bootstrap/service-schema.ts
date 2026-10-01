import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { roles, infrastructure } from './ownership';

export async function createSchema(
  client: Client,
  service: keyof typeof roles,
  root: string,
) {
  const allowed = new Set([...roles[service], ...infrastructure]);
  // Original migrations are read, never edited or reset. Only service-owned tables are created.
  for (const migration of [
    '20260930000000_reliable_workspaces',
    '20260930020000_social_login',
    '20261001000000_service_foundations',
    '20261001010000_discovery_profiles',
  ]) {
    const text = readFileSync(
      resolve(root, 'apps/api/prisma/migrations', migration, 'migration.sql'),
      'utf8',
    ).replace(/--[^\n]*/g, '');
    for (const statement of text
      .split(';')
      .map((value) => value.trim())
      .filter(Boolean)) {
      const create = statement.match(/^CREATE TABLE (tc_\w+)/);
      if (create && allowed.has(create[1]))
        await client.query(
          statement
            .replace('CREATE TABLE', 'CREATE TABLE IF NOT EXISTS')
            .replace(/\s+REFERENCES tc_\w+\(\w+\) ON DELETE RESTRICT/g, ''),
        );
      if (
        /^ALTER TABLE tc_account ALTER COLUMN/.test(statement) &&
        allowed.has('tc_account')
      )
        await client.query(statement);
      if (
        /^ALTER TABLE (tc_\w+) ADD COLUMN/.exec(statement)?.[1] &&
        allowed.has(/^ALTER TABLE (tc_\w+) ADD COLUMN/.exec(statement)![1])
      )
        await client.query(
          statement.replace('ADD COLUMN', 'ADD COLUMN IF NOT EXISTS'),
        );
      const index = statement.match(
        /^CREATE (?:UNIQUE )?INDEX \w+ ON (tc_\w+)/,
      );
      if (index && allowed.has(index[1]))
        await client.query(statement.replace('INDEX ', 'INDEX IF NOT EXISTS '));
    }
  }
  const constraints = readFileSync(
    resolve(
      root,
      'apps/api/prisma/migrations/20260930000000_reliable_workspaces/migration.sql',
    ),
    'utf8',
  );
  for (const statement of constraints.split(';')) {
    const foreign = statement
      .trim()
      .match(
        /^ALTER TABLE (tc_\w+) ADD FOREIGN KEY \((\w+)\) REFERENCES (tc_\w+)\((\w+)\)/,
      );
    if (!foreign || !allowed.has(foreign[1]) || !allowed.has(foreign[3]))
      continue;
    const name = `${foreign[1]}_${foreign[2]}_service_fk`;
    const exists = await client.query(
      'SELECT 1 FROM pg_constraint WHERE conname=$1',
      [name],
    );
    if (!exists.rowCount)
      await client.query(
        `ALTER TABLE ${foreign[1]} ADD CONSTRAINT ${name} FOREIGN KEY (${foreign[2]}) REFERENCES ${foreign[3]}(${foreign[4]}) ON DELETE RESTRICT`,
      );
  }
}
