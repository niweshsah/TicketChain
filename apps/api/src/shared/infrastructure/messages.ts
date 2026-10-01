import amqp, { type ChannelModel, type ConfirmChannel } from 'amqplib';
import { randomUUID } from 'node:crypto';
import { config } from '../config';
import { db, rows, type Tx } from '../db';

export interface DomainMessage {
  id: string;
  type: string;
  schemaVersion: 1;
  aggregateId: string;
  aggregateVersion: number;
  occurredAt: string;
  correlationId: string;
  payload: Record<string, unknown>;
}
export async function publishIntent(
  tx: Tx,
  type: string,
  aggregateId: string,
  payload: Record<string, unknown>,
  destination: string,
  dedupe?: string,
) {
  if (config.SERVICE_NAME === 'standalone') return;
  const id = randomUUID();
  const version = await tx.$queryRawUnsafe<{ version: bigint }[]>(
    'INSERT INTO tc_aggregateversion(id,version) VALUES($1,1) ON CONFLICT(id) DO UPDATE SET version=tc_aggregateversion.version+1 RETURNING version',
    `${type}:${aggregateId}`,
  );
  const message: DomainMessage = {
    id,
    type,
    schemaVersion: 1,
    aggregateId,
    aggregateVersion: Number(version[0].version),
    occurredAt: new Date().toISOString(),
    correlationId: aggregateId,
    payload,
  };
  await tx.$executeRawUnsafe(
    'INSERT INTO tc_outbox(id,dedupe,destination,message) VALUES($1::uuid,$2,$3,$4::jsonb) ON CONFLICT(dedupe) DO NOTHING',
    id,
    dedupe || id,
    destination,
    JSON.stringify(message, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    ),
  );
}

let connection: ChannelModel | undefined;
let publisher: ConfirmChannel | undefined;
const returned = new Set<string>();
export async function broker() {
  if (publisher) return publisher;
  try {
    await connection?.close();
  } catch {
    /* Already disconnected. */
  }
  connection = await amqp.connect(config.RABBITMQ_URL!);
  connection.on('error', () => {
    publisher = undefined;
  });
  connection.on('close', () => {
    publisher = undefined;
  });
  publisher = await connection.createConfirmChannel();
  publisher.on('error', () => {
    publisher = undefined;
  });
  publisher.on('return', (message) => {
    if (message.properties.messageId)
      returned.add(message.properties.messageId);
  });
  for (const service of ['booking', 'payments', 'catalog']) {
    await publisher.assertQueue(`ticketchain.${service}.dead`, {
      durable: true,
      arguments: { 'x-queue-type': 'quorum' },
    });
    await publisher.assertQueue(`ticketchain.${service}`, {
      durable: true,
      arguments: {
        'x-queue-type': 'quorum',
        'x-dead-letter-exchange': '',
        'x-dead-letter-routing-key': `ticketchain.${service}.dead`,
        'x-delivery-limit': 6,
      },
    });
  }
  return publisher;
}
export async function flushOutbox() {
  const owner = randomUUID();
  const pending = await rows<{
    id: string;
    destination: string;
    message: DomainMessage;
  }>(
    db,
    `
      UPDATE tc_outbox
      SET lease_owner=$1,lease_until=now()+interval '30 seconds'
      WHERE id IN (SELECT id
      FROM tc_outbox
      WHERE published_at IS NULL
      AND (lease_until IS NULL
      OR lease_until<now())
      ORDER BY created_at FOR UPDATE SKIP LOCKED
      LIMIT 50)
      RETURNING id,destination,message
    `,
    owner,
  );
  if (!pending.length) return;
  const channel = await broker();
  for (const item of pending) {
    await new Promise<void>((resolve, reject) => {
      channel.sendToQueue(
        `ticketchain.${item.destination}`,
        Buffer.from(JSON.stringify(item.message)),
        {
          persistent: true,
          mandatory: true,
          messageId: item.id,
          contentType: 'application/json',
        },
        (error) => (error ? reject(error) : resolve()),
      );
    });
    if (returned.delete(item.id))
      throw new Error('Message was not routed to a durable queue');
    await db.$executeRawUnsafe(
      'UPDATE tc_outbox SET published_at=now(),lease_until=NULL WHERE id=$1::uuid AND lease_owner=$2',
      item.id,
      owner,
    );
  }
}
export async function closeBroker() {
  await connection?.close();
  publisher = undefined;
}
