import {
  broker,
  closeBroker,
  type DomainMessage,
} from '../src/shared/infrastructure/messages';
import { config } from '../src/shared/config';
import { db } from '../src/shared/db';
import { z } from 'zod';

async function main() {
  const [command = 'list', messageId, reference] = process.argv.slice(2);
  if (!['booking', 'payments', 'catalog'].includes(config.SERVICE_NAME))
    throw new Error('Run queue operations inside a service worker container');
  const channel = await broker();
  const queue = `ticketchain.${config.SERVICE_NAME}`;
  if (command === 'list') {
    for (const name of [queue, `${queue}.dead`]) {
      const result = await channel.checkQueue(name);
      console.log(
        JSON.stringify({
          queue: name,
          ready: result.messageCount,
          consumers: result.consumerCount,
        }),
      );
    }
    return;
  }
  if (command !== 'replay')
    throw new Error('Use list | replay MESSAGE_ID RECONCILIATION_REFERENCE');
  z.string().uuid().parse(messageId);
  if (!reference || reference.length < 10)
    throw new Error('A reconciliation reference is required before replay');
  const available = await channel.checkQueue(`${queue}.dead`);
  for (let index = 0; index < available.messageCount; index++) {
    const raw = await channel.get(`${queue}.dead`, { noAck: false });
    if (!raw) break;
    const message = JSON.parse(raw.content.toString()) as DomainMessage;
    if (message.id === messageId) {
      // Preserve the identity so an already completed message remains a no-op.
      await new Promise<void>((resolve, reject) =>
        channel.sendToQueue(
          queue,
          raw.content,
          {
            persistent: true,
            mandatory: true,
            messageId: message.id,
            contentType: 'application/json',
          },
          (error) => (error ? reject(error) : resolve()),
        ),
      );
      channel.ack(raw);
      console.log(
        JSON.stringify({
          event: 'reviewed_message_replay',
          messageId: message.id,
          reference,
        }),
      );
      return;
    }
    await new Promise<void>((resolve, reject) =>
      channel.sendToQueue(
        `${queue}.dead`,
        raw.content,
        {
          persistent: true,
          messageId: message.id,
          contentType: 'application/json',
        },
        (error) => (error ? reject(error) : resolve()),
      ),
    );
    channel.ack(raw);
  }
  throw new Error('Message was not found in the dead-letter queue');
}
void main().finally(async () => {
  await closeBroker();
  await db.$disconnect();
});
