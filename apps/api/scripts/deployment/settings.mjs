import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../../../../', import.meta.url));
export const envPath = resolve(
  root,
  process.env.TC_DEMO_ENV_FILE || '.env.demo',
);
export const project = 'ticketchain-demo';
const secretNames = [
  'POSTGRES_PASSWORD',
  'RABBITMQ_PASSWORD',
  'JWT_SECRET',
  'SERVICE_TOKEN',
  'DATABASE_PASSWORD_IDENTITY',
  'DATABASE_PASSWORD_BOOKING',
  'DATABASE_PASSWORD_PAYMENTS',
  'DATABASE_PASSWORD_CATALOG',
  'AVATAR_S3_ACCESS_KEY',
  'AVATAR_S3_SECRET_KEY',
  'DEMO_ACCOUNT_PASSWORD',
];

export function initialize(address) {
  if (existsSync(envPath))
    throw new Error(`${envPath} already exists; it was not changed`);
  if (!address) throw new Error('Use init PUBLIC_IPV4_OR_HOSTNAME');
  const hostname =
    isIP(address) === 4 ? `ticketchain.${address}.sslip.io` : address;
  if (
    !/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*$/i.test(
      hostname,
    )
  )
    throw new Error(
      'Provide an IPv4 address or a DNS hostname, without scheme or port',
    );
  const values = { DEMO_HOSTNAME: hostname };
  for (const name of secretNames)
    values[name] = randomBytes(24).toString('hex');
  writeFileSync(
    envPath,
    Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n') + '\n',
    { flag: 'wx', mode: 0o600 },
  );
  console.log(
    `Created ${envPath}. Save a secure copy; credentials are not printed.`,
  );
  console.log(`Demo URL: https://${hostname}`);
}

export function settings() {
  if (!existsSync(envPath)) throw new Error('Run init first');
  const values = Object.fromEntries(
    readFileSync(envPath, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const split = line.indexOf('=');
        return [line.slice(0, split), line.slice(split + 1)];
      }),
  );
  for (const name of secretNames)
    if (!/^[a-f0-9]{48}$/.test(values[name] || ''))
      throw new Error(`Missing or invalid ${name}; use generated credentials`);
  if (!values.DEMO_HOSTNAME) throw new Error('DEMO_HOSTNAME is required');
  return values;
}
