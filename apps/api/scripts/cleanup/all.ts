import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import amqp from 'amqplib';
import type { Client } from 'pg';
import {
  closeAll,
  connectService,
  connectSource,
  inTransaction,
  type ServiceName,
} from './database';
import { roles } from '../bootstrap/ownership';

async function listApplicationTables(client: Client) {
  const result = await client.query<{ name: string }>(
    `SELECT format('%I.%I', schemaname,tablename) AS name
     FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'
     ORDER BY tablename`,
  );
  return result.rows.map((row) => row.name);
}

async function databaseReport(client: Client) {
  const tables = await listApplicationTables(client);
  const counts = [];
  for (const table of tables) {
    const result = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ${table}`,
    );
    counts.push({ table, rows: Number(result.rows[0].count) });
  }
  return counts.filter((row) => row.rows > 0);
}

export async function previewAll() {
  const clients = [await connectSource()];
  try {
    for (const service of Object.keys(roles) as ServiceName[])
      clients.push(await connectService(service));
    const reports = await Promise.all(clients.map(databaseReport));
    return Object.fromEntries(
      ['source', ...Object.keys(roles)].map((name, index) => [
        name,
        reports[index],
      ]),
    );
  } finally {
    await closeAll(clients);
  }
}

async function clearDatabase(client: Client) {
  const tables = await listApplicationTables(client);
  if (!tables.length) return;
  await inTransaction(client, async () => {
    await client.query(
      `TRUNCATE TABLE ${tables.join(',')} RESTART IDENTITY CASCADE`,
    );
  });
}

async function cleanAvatarBucket() {
  const storage = new S3Client({
    endpoint: process.env.AVATAR_S3_ENDPOINT || 'http://localhost:9000',
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.AVATAR_S3_ACCESS_KEY || 'localavatars',
      secretAccessKey:
        process.env.AVATAR_S3_SECRET_KEY ||
        'local-avatar-storage-replace-in-production',
    },
  });
  const bucket = process.env.AVATAR_S3_BUCKET || 'avatars';
  try {
    let token: string | undefined;
    do {
      const page = await storage.send(
        new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }),
      );
      const objects = (page.Contents || []).flatMap((item) =>
        item.Key ? [{ Key: item.Key }] : [],
      );
      if (objects.length)
        await storage.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: objects },
          }),
        );
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
  } catch (error) {
    if ((error as Error).name !== 'NoSuchBucket') throw error;
  } finally {
    storage.destroy();
  }
}

async function cleanIndex() {
  const base = process.env.ELASTICSEARCH_URL || 'http://localhost:9200';
  const response = await fetch(`${base}/ticketchain-events-v1`, {
    method: 'DELETE',
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok && response.status !== 404)
    throw new Error(`Search index cleanup failed (${response.status})`);
}

async function cleanRedis() {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('Set REDIS_URL for whole-database cleanup');
  const { createClient } = await import('redis');
  const redis = createClient({ url });
  redis.on('error', () => undefined);
  try {
    await redis.connect();
    await redis.flushDb();
  } finally {
    redis.destroy();
  }
}

async function cleanBroker() {
  const url = process.env.RABBITMQ_URL;
  if (!url) throw new Error('Set RABBITMQ_URL for whole-database cleanup');
  const connection = await amqp.connect(url);
  try {
    const channel = await connection.createChannel();
    for (const service of ['booking', 'payments', 'catalog']) {
      for (const queue of [
        `ticketchain.${service}`,
        `ticketchain.${service}.dead`,
      ]) {
        await channel.checkQueue(queue);
        await channel.purgeQueue(queue);
      }
    }
    await channel.close();
  } finally {
    await connection.close();
  }
}

export async function validateExternalServices() {
  const searchUrl = process.env.ELASTICSEARCH_URL || 'http://localhost:9200';
  const health = await fetch(`${searchUrl}/_cluster/health`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!health.ok) throw new Error('Elasticsearch is unavailable');

  const redisUrl = process.env.REDIS_URL;
  const brokerUrl = process.env.RABBITMQ_URL;
  if (!redisUrl || !brokerUrl)
    throw new Error(
      'Set REDIS_URL and RABBITMQ_URL before whole-database cleanup',
    );
  const { createClient } = await import('redis');
  const redis = createClient({ url: redisUrl });
  redis.on('error', () => undefined);
  try {
    await redis.connect();
    await redis.ping();
  } finally {
    redis.destroy();
  }
  const connection = await amqp.connect(brokerUrl);
  try {
    const channel = await connection.createChannel();
    for (const service of ['booking', 'payments', 'catalog']) {
      await channel.checkQueue(`ticketchain.${service}`);
      await channel.checkQueue(`ticketchain.${service}.dead`);
    }
    await channel.close();
  } finally {
    await connection.close();
  }

  const storage = new S3Client({
    endpoint: process.env.AVATAR_S3_ENDPOINT || 'http://localhost:9000',
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.AVATAR_S3_ACCESS_KEY || 'localavatars',
      secretAccessKey:
        process.env.AVATAR_S3_SECRET_KEY ||
        'local-avatar-storage-replace-in-production',
    },
  });
  try {
    await storage.send(
      new ListObjectsV2Command({
        Bucket: process.env.AVATAR_S3_BUCKET || 'avatars',
        MaxKeys: 1,
      }),
    );
  } catch (error) {
    if ((error as Error).name !== 'NoSuchBucket') throw error;
  } finally {
    storage.destroy();
  }
}

export async function clearAll() {
  const clients: Client[] = [await connectSource()];
  try {
    for (const service of Object.keys(roles) as ServiceName[])
      clients.push(await connectService(service));
    for (const client of clients) await clearDatabase(client);
  } finally {
    await closeAll(clients);
  }
  await cleanAvatarBucket();
  await cleanIndex();
  await cleanRedis();
  await cleanBroker();
}
