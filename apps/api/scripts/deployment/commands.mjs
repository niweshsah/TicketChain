import { spawnSync } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';
import { envPath, project, root, settings } from './settings.mjs';

export function docker(args, options = {}) {
  const result = spawnSync('docker', args, {
    cwd: root,
    env: { COMPOSE_PARALLEL_LIMIT: '2', ...process.env, ...settings() },
    stdio: options.capture ? 'pipe' : 'inherit',
    encoding: 'utf8',
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (options.capture && result.stderr) process.stderr.write(result.stderr);
    throw new Error(`Docker command failed (${result.status})`);
  }
  return result.stdout;
}

export function compose(args, options) {
  return docker(
    [
      'compose',
      '--env-file',
      envPath,
      '-p',
      project,
      '-f',
      'compose.yaml',
      '-f',
      'compose.demo.yaml',
      ...(process.env.TC_DEMO_OVERRIDE_FILE
        ? ['-f', process.env.TC_DEMO_OVERRIDE_FILE]
        : []),
      ...args,
    ],
    options,
  );
}

export function postgres(args, file, direction) {
  const descriptor = openSync(file, direction === 'read' ? 'r' : 'wx', 0o600);
  try {
    compose(['exec', '-T', 'postgres', ...args], {
      stdio:
        direction === 'read'
          ? [descriptor, 'inherit', 'inherit']
          : ['ignore', descriptor, 'inherit'],
    });
  } finally {
    closeSync(descriptor);
  }
}

export const writers = [
  'edge',
  'web',
  'identity',
  'booking',
  'payments',
  'catalog',
  'booking-worker',
  'payments-worker',
  'catalog-worker',
];

export async function verify() {
  const lines = compose(['ps', '--format', 'json'], { capture: true }).trim();
  const containers = lines.startsWith('[')
    ? JSON.parse(lines)
    : lines
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
  const required = [
    ...writers,
    'postgres',
    'redis',
    'rabbitmq',
    'elasticsearch',
    'minio',
  ];
  for (const service of required) {
    const instances = containers.filter(
      (container) => container.Service === service,
    );
    if (
      instances.length !== 1 ||
      instances[0].State !== 'running' ||
      instances[0].Health !== 'healthy'
    )
      throw new Error(`Expected exactly one healthy ${service} container`);
  }
  const origin = `https://${settings().DEMO_HOSTNAME}`;
  for (const path of [
    '/',
    '/profile',
    '/api/v1/events',
    '/api/v1/auth/providers',
  ]) {
    const response = await fetch(origin + path, {
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`${path} returned ${response.status}`);
    if (path === '/api/v1/events' && !(await response.json()).events?.length)
      throw new Error(
        'Discovery projection has no demo events yet; retry after Catalog refresh',
      );
  }
  console.log(
    `Verified single-instance services and HTTPS routes at ${origin}`,
  );
}
