import { messageHandlers as booking } from '../../services/booking/messages';
import { messageHandlers as catalog } from '../../services/catalog/messages';
import { messageHandlers as payments } from '../../services/payments/messages';
import { config } from '../config';
import { db, one } from '../db';
import { type DomainMessage } from '../infrastructure/messages';
import { runQueuedJob } from './job-runner';

const consumers: Record<
  string,
  Record<string, (message: DomainMessage) => Promise<unknown>>
> = { booking, payments, catalog };
export async function handleMessage(message: DomainMessage) {
  if (
    await one(
      db,
      'SELECT message_id FROM tc_inbox WHERE consumer=$1 AND message_id=$2::uuid',
      config.SERVICE_NAME,
      message.id,
    )
  )
    return;
  if (message.type === 'job.ready') await runQueuedJob(message);
  else {
    const handle = consumers[config.SERVICE_NAME]?.[message.type];
    if (!handle) throw new Error('Unsupported message type for this consumer');
    await handle(message);
  }
  await db.$executeRawUnsafe(
    'INSERT INTO tc_inbox(consumer,message_id) VALUES($1,$2::uuid) ON CONFLICT DO NOTHING',
    config.SERVICE_NAME,
    message.id,
  );
}
