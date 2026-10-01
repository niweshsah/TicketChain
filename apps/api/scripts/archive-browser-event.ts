import { db, one, rows } from '../src/shared/db';
import { transitionEvent } from '../src/services/booking/events/lifecycle';
import { type Account, type Listing } from '../src/shared/types';
async function main() {
  const matches = await rows<Listing>(
    db,
    'SELECT * FROM tc_listing WHERE title=$1',
    'Browser concert 1790830827846 desktop-dark',
  );
  for (const event of matches) {
    if (!['draft', 'published'].includes(event.status)) continue;
    const owner = (await one<Account>(
      db,
      'SELECT * FROM tc_account WHERE id=$1::uuid',
      event.owner_id,
    ))!;
    await transitionEvent(owner, event.id, 'cancel');
    console.log(JSON.stringify({ archived: event.id, title: event.title }));
  }
}
void main().finally(() => db.$disconnect());
