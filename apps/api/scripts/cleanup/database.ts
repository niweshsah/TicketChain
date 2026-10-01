import type { Client } from 'pg';
import { Client as PgClient } from 'pg';
import { roles } from '../bootstrap/ownership';

export type ServiceName = keyof typeof roles;

export function sourceConnectionString() {
  const value = process.env.SOURCE_DATABASE_URL;
  if (!value) throw new Error('Set SOURCE_DATABASE_URL before cleanup');
  const url = new URL(value);
  const database = url.pathname.slice(1);
  if (!['ticketchain_demo', 'ticketchain_test'].includes(database))
    throw new Error(`Refusing unsupported database: ${database}`);
  return { url, database };
}

export function connectionString(service: ServiceName) {
  const { url, database } = sourceConnectionString();
  url.pathname = `${database}_${service}`;
  url.username = `tc_${service}`;
  url.password =
    process.env[`DATABASE_PASSWORD_${service.toUpperCase()}`] ||
    `local-${service}-replace-before-production`;
  return url.toString();
}

export async function connectSource() {
  const { url } = sourceConnectionString();
  return connect(url.toString(), 'ticketchain-cleanup-source');
}

export async function connectService(service: ServiceName) {
  return connect(connectionString(service), `ticketchain-cleanup-${service}`);
}

async function connect(connectionString: string, applicationName: string) {
  const client = new PgClient({
    connectionString,
    application_name: applicationName,
  });
  await client.connect();
  return client;
}

export async function inTransaction<T>(client: Client, work: () => Promise<T>) {
  await client.query('BEGIN');
  try {
    const result = await work();
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

export async function closeAll(clients: Client[]) {
  await Promise.all(clients.map((client) => client.end()));
}
