import { createHash } from 'node:crypto';
import { db, rows, transaction } from '../src/shared/db';
import { config } from '../src/shared/config';
import { notifyEvent } from '../src/services/booking/events/queries';

async function main() {
  const name = new URL(config.DATABASE_URL).pathname;
  if (
    name !== `/${config.DEMO_DATABASE_NAME}` &&
    name !== `/${config.DEMO_DATABASE_NAME}_booking`
  )
    throw new Error('Imagery updates are restricted to demo databases');
  const events = await rows<{ id: string; image_url: string }>(
    db,
    "SELECT e.id,e.image_url FROM tc_listing e JOIN tc_account a ON a.id=e.owner_id WHERE a.email='organizer@demo.ticketchain.local'",
  );
  const demoIds = new Set([
    '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000101',
    '00000000-0000-4000-8000-000000000102',
  ]);
  for (let index = 0; index < 30; index++) {
    const digest = createHash('sha256')
      .update(`expanded-demo-event:${index}`)
      .digest('hex');
    demoIds.add(
      `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`,
    );
  }
  let updated = 0;
  for (const event of events) {
    if (!demoIds.has(event.id)) continue;
    if (
      ![
        'photo-1459749411175-04bf5292ceea',
        'photo-1533174072545-7a4b6ad7a6c3',
        'pexels-photo-1105666',
      ].some((value) => event.image_url.includes(value))
    )
      continue;
    const selected =
      (createHash('sha256').update(event.id).digest()[0] % 8) + 1;
    await transaction(async (tx) => {
      const changed = await tx.$executeRawUnsafe(
        'UPDATE tc_listing SET image_url=$2 WHERE id=$1::uuid AND image_url=$3',
        event.id,
        `https://ticketchain.local/images/concerts/concert-${selected}.jpg`,
        event.image_url,
      );
      if (changed) {
        await notifyEvent(tx, event.id);
        updated++;
      }
    });
  }
  // Demonstrate the queue on one untouched expanded demo event; inventory is never reseeded.
  await transaction(async (tx) => {
    const digest = createHash('sha256')
      .update('expanded-demo-event:29')
      .digest('hex');
    const queueId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
    const event = events.find((value) => value.id === queueId);
    if (event) {
      await tx.$executeRawUnsafe(
        'UPDATE tc_listing SET waiting_room=true WHERE id=$1::uuid',
        event.id,
      );
      await notifyEvent(tx, event.id);
    }
  });
  console.log(JSON.stringify({ updated }));
}
void main().finally(() => db.$disconnect());
