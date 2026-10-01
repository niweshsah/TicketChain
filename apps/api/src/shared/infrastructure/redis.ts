import { createClient } from 'redis';
import { config } from '../config';
import { AppError } from '../errors';

const client = config.REDIS_URL
  ? createClient({
      url: config.REDIS_URL,
      socket: {
        connectTimeout: 1500,
        reconnectStrategy: (retries) => Math.min(1000, retries * 100),
      },
    })
  : undefined;
client?.on('error', () => {
  /* Request failures are surfaced without connection secrets. */
});
let connecting: Promise<unknown> | undefined;
export async function redis() {
  if (!client)
    throw new AppError(
      503,
      'QUEUE_UNAVAILABLE',
      'The waiting room is temporarily unavailable. Please retry.',
    );
  if (!client.isOpen)
    connecting ||= client.connect().finally(() => {
      connecting = undefined;
    });
  try {
    if (connecting)
      await Promise.race([
        connecting,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Redis connection timeout')), 2000),
        ),
      ]);
    if (!client.isReady) throw new Error();
    return client;
  } catch {
    throw new AppError(
      503,
      'QUEUE_UNAVAILABLE',
      'The waiting room is temporarily unavailable. Please retry.',
    );
  }
}
export async function closeRedis() {
  if (client?.isOpen) client.destroy();
}
