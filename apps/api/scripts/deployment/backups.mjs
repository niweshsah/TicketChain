import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { compose, docker, postgres, writers } from './commands.mjs';
import { project, root, settings } from './settings.mjs';

const databases = [
  'ticketchain_demo',
  ...['identity', 'booking', 'payments', 'catalog'].map(
    (service) => `ticketchain_demo_${service}`,
  ),
];
const volumes = [
  'avatar-data',
  'jwt-private',
  'jwt-public',
  'rabbitmq-data',
  'redis-data',
  'elasticsearch-data',
  'source-backups',
  'caddy-data',
  'caddy-config',
];
const settingsDigest = () =>
  createHash('sha256').update(JSON.stringify(settings())).digest('hex');

function archive(directory, volume, restoring = false) {
  // Pre-create as the deployment user so Linux Docker does not leave a root-owned file.
  if (!restoring)
    writeFileSync(resolve(directory, `${volume}.tar`), '', {
      flag: 'wx',
      mode: 0o600,
    });
  docker([
    'run',
    '--rm',
    '--user',
    '0',
    '-v',
    `${project}_${volume}:/data${restoring ? '' : ':ro'}`,
    '-v',
    `${directory}:/backup${restoring ? ':ro' : ''}`,
    'postgres:17-alpine',
    'tar',
    restoring ? 'xf' : 'cf',
    `/backup/${volume}.tar`,
    '-C',
    '/data',
    '.',
  ]);
}

export function backup() {
  const directory = resolve(
    root,
    '.runtime/demo-backups',
    new Date().toISOString().replaceAll(':', '-'),
  );
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  compose(['stop', ...writers]);
  try {
    for (const database of databases)
      postgres(
        ['pg_dump', '-U', 'ticketchain', '-d', database, '-Fc'],
        resolve(directory, `${database}.dump`),
        'write',
      );
    // Stop infrastructure before archiving on-disk broker/search/cache state.
    compose(['stop', 'rabbitmq', 'redis', 'elasticsearch', 'minio']);
    for (const volume of volumes) archive(directory, volume);
    writeFileSync(
      resolve(directory, 'manifest.json'),
      JSON.stringify({
        version: 1,
        project,
        hostname: settings().DEMO_HOSTNAME,
        settingsDigest: settingsDigest(),
      }),
      { mode: 0o600 },
    );
    console.log(
      `Backup saved to ${directory}. Copy it and .env.demo off the server.`,
    );
  } finally {
    compose([
      'up',
      '-d',
      '--no-build',
      '--no-deps',
      '--wait',
      '--wait-timeout',
      '300',
      'rabbitmq',
      'redis',
      'elasticsearch',
      'minio',
      ...writers,
    ]);
  }
}

export function restore(path, confirmation) {
  if (confirmation !== 'TICKETCHAIN_DEMO')
    throw new Error(
      'Restore requires BACKUP_PATH TICKETCHAIN_DEMO and replaces only the demo project data',
    );
  const directory = resolve(path || '');
  for (const file of [
    ...databases.map((database) => `${database}.dump`),
    ...volumes.map((volume) => `${volume}.tar`),
    'manifest.json',
  ])
    if (!existsSync(resolve(directory, file)))
      throw new Error(`Incomplete backup: missing ${file}`);
  const manifest = JSON.parse(
    readFileSync(resolve(directory, 'manifest.json'), 'utf8'),
  );
  if (
    manifest.version !== 1 ||
    manifest.project !== project ||
    manifest.settingsDigest !== settingsDigest()
  )
    throw new Error(
      'Restore requires the original .env.demo and matching backup manifest',
    );
  // Removing containers preserves volumes and avoids stale processes writing restored data.
  compose(['down']);
  compose([
    'create',
    'postgres',
    'rabbitmq',
    'redis',
    'elasticsearch',
    'minio',
    'bootstrap',
    'edge',
  ]);
  for (const volume of volumes) {
    docker([
      'run',
      '--rm',
      '--user',
      '0',
      '-v',
      `${project}_${volume}:/data`,
      'postgres:17-alpine',
      'find',
      '/data',
      '-mindepth',
      '1',
      '-delete',
    ]);
    archive(directory, volume, true);
  }
  compose(['up', '-d', '--no-deps', '--wait', 'postgres']);
  compose(['run', '--rm', '--no-deps', 'migrate']);
  postgres(
    [
      'pg_restore',
      '-U',
      'ticketchain',
      '-d',
      'ticketchain_demo',
      '--clean',
      '--if-exists',
      '--exit-on-error',
    ],
    resolve(directory, 'ticketchain_demo.dump'),
    'read',
  );
  const existing = Number(
    compose(
      [
        'exec',
        '-T',
        'postgres',
        'psql',
        '-U',
        'ticketchain',
        '-d',
        'postgres',
        '-Atc',
        "SELECT count(*) FROM pg_database WHERE datname IN ('ticketchain_demo_identity','ticketchain_demo_booking','ticketchain_demo_payments','ticketchain_demo_catalog')",
      ],
      { capture: true },
    ).trim(),
  );
  if (existing === 0) compose(['run', '--rm', '--no-deps', 'bootstrap']);
  else if (existing !== 4)
    throw new Error(
      'Incomplete service databases; restore into a fresh demo project',
    );
  for (const database of databases.slice(1))
    postgres(
      [
        'pg_restore',
        '-U',
        'ticketchain',
        '-d',
        database,
        '--clean',
        '--if-exists',
        '--exit-on-error',
      ],
      resolve(directory, `${database}.dump`),
      'read',
    );
  compose(['up', '-d', '--no-build', '--wait', '--wait-timeout', '600']);
  console.log('Demo restored. Run verify and the browser journeys.');
}
