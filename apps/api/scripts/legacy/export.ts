import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { assertRule } from '../../src/shared/errors';
import { tableNames, save } from './contracts';

export async function exportLegacy(file: string) {
  assertRule(
    process.env.LEGACY_DATABASE_URL,
    'SOURCE_REQUIRED',
    'Set LEGACY_DATABASE_URL to the read-only source connection',
  );
  const source = new PrismaClient({
    datasourceUrl: process.env.LEGACY_DATABASE_URL,
  });
  try {
    const tables: Record<string, unknown[]> = {};
    await source.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        for (const name of tableNames)
          tables[name] = await tx.$queryRawUnsafe(
            `SELECT * FROM "${name}" ORDER BY id`,
          );
      },
      { timeout: 60000 },
    );
    save(file, {
      version: 1,
      source: createHash('sha256').update(JSON.stringify(tables)).digest('hex'),
      exportedAt: new Date().toISOString(),
      tables,
    });
  } finally {
    await source.$disconnect();
  }
}
