import { readFileSync } from 'node:fs';
import { db } from '../src/shared/db';
import { assertRule } from '../src/shared/errors';
import {
  dumpSchema,
  mappingSchema,
  save,
  tableNames,
} from './legacy/contracts';
import { exportLegacy } from './legacy/export';
import { analyzeLegacy } from './legacy/analysis';
import { verifyLegacy } from './legacy/verify';
import { importLegacy } from './legacy/import';

async function main() {
  const [
    command,
    file,
    mappingFile,
    reportFile = 'artifacts/legacy-report.json',
  ] = process.argv.slice(2);
  if (command === 'export') return exportLegacy(file);
  assertRule(
    ['dry-run', 'import', 'verify'].includes(command),
    'COMMAND_REQUIRED',
    'Use export FILE | dry-run FILE MAPPING REPORT | import FILE MAPPING REPORT | verify FILE MAPPING REPORT',
  );
  const dump = dumpSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
  const mapping = mappingSchema.parse(
    JSON.parse(readFileSync(mappingFile, 'utf8')),
  );
  const analysis = analyzeLegacy(dump, mapping);
  const { list, issues, orders } = analysis;
  const report = {
    source: dump.source,
    command,
    counts: Object.fromEntries(tableNames.map((t) => [t, list(t).length])),
    resolvedOrders: orders.filter((o) => o.resolved).length,
    issues,
    walletPolicy:
      'All legacy wallet addresses remain unverified and are not linked',
  };
  save(reportFile, report);
  if (command === 'dry-run') return;
  if (command === 'verify') return verifyLegacy(analysis);
  await importLegacy(analysis);
  console.log(
    JSON.stringify({ imported: true, source: dump.source, report: reportFile }),
  );
}
void main().finally(() => db.$disconnect());
