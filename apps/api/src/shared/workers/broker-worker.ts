import { rebuildSearch } from '../../services/catalog/rebuild';
import { config } from '../config';
import { db } from '../db';
import { messageSchema } from '../infrastructure/message-schemas';
import { broker, closeBroker, flushOutbox } from '../infrastructure/messages';
import { closeRedis } from '../infrastructure/redis';
import { scheduleJobs } from './job-scheduler';
import { handleMessage } from './message-dispatcher';

export async function startWorker() {
  let stopping = false;
  let connected = false;
  let active = 0;
  let searchReady = false;
  process.on('SIGTERM', () => {
    stopping = true;
  });
  process.on('SIGINT', () => {
    stopping = true;
  });
  if (config.SERVICE_NAME === 'catalog') {
    try {
      await rebuildSearch();
      searchReady = true;
    } catch {
      /* Worker retries after dependencies recover. */
    }
  }
  while (!stopping) {
    try {
      if (config.SERVICE_NAME === 'catalog' && !searchReady) {
        await rebuildSearch();
        searchReady = true;
      }
      const channel = await broker();
      if (!connected) {
        await channel.prefetch(8);
        channel.on('close', () => {
          connected = false;
        });
        await channel.consume(`ticketchain.${config.SERVICE_NAME}`, (raw) => {
          if (!raw) return;
          active++;
          void (async () => {
            try {
              const message = messageSchema.parse(
                JSON.parse(raw.content.toString()),
              );
              await handleMessage(message);
              channel.ack(raw);
            } catch {
              const count = Number(
                raw.properties.headers?.['x-delivery-count'] || 0,
              );
              console.error(
                JSON.stringify({
                  event: 'message_failed',
                  service: config.SERVICE_NAME,
                  messageId: raw.properties.messageId,
                  attempt: count + 1,
                }),
              );
              await new Promise((resolve) =>
                setTimeout(resolve, Math.min(5000, 500 * 2 ** count)),
              );
              channel.nack(raw, false, true);
            } finally {
              active--;
            }
          })().catch(() => undefined);
        });
        connected = true;
      }
      await db.$executeRawUnsafe(
        "INSERT INTO tc_ratebucket(key,count,expires_at) VALUES('worker-health',1,now()+interval '30 seconds') ON CONFLICT(key) DO UPDATE SET expires_at=EXCLUDED.expires_at",
      );
      if (config.SERVICE_NAME !== 'catalog') await scheduleJobs();
      await flushOutbox();
    } catch {
      console.error(
        JSON.stringify({
          event: 'worker_dependency_failure',
          service: config.SERVICE_NAME,
        }),
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const deadline = Date.now() + 15000;
  while (active && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 100));
  await closeBroker();
  await closeRedis();
  await db.$disconnect();
}
