import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool, asUser, applySchema } from './database.js';

const owner = randomUUID(),
  buyer = randomUUID(),
  stranger = randomUUID();
const payload = {
  title: 'Backend verification concert',
  description: 'An isolated database verification event.',
  category: 'Concert',
  city: 'Bengaluru',
  venue: 'Test Hall',
  venueAddress: 'Example Road',
  timezone: 'Asia/Kolkata',
  imageUrl: 'https://ticketchain.local/images/concerts/concert-1.jpg',
  startsAt: new Date(Date.now() + 30 * 86400000).toISOString(),
  endsAt: new Date(Date.now() + 30 * 86400000 + 3600000).toISOString(),
  languages: ['English'],
  agePolicy: '18+',
  performers: ['Verification band'],
  tiers: [{ name: 'General admission', pricePaise: 12345, quantity: 3 }],
};
let eventId, tierId, newTierId;
const book = (tier, key = randomUUID(), quantity = 1) =>
  asUser(buyer, 'SELECT public.tc_book_event($1,$2::jsonb,$3) AS id', [
    eventId,
    JSON.stringify([{ tierId: tier, quantity }]),
    key,
  ]);
const save = (body) =>
  asUser(owner, 'SELECT public.tc_save_event($1,$2::jsonb) AS id', [
    eventId,
    JSON.stringify(body),
  ]);

before(async () => {
  await applySchema();
  for (const id of [owner, buyer, stranger])
    await pool.query('INSERT INTO auth.users(id) VALUES($1)', [id]);
  const created = await asUser(
    owner,
    'SELECT public.tc_save_event(null,$1::jsonb) AS id',
    [JSON.stringify(payload)],
  );
  eventId = created.rows[0].id;
  tierId = (
    await pool.query('SELECT id FROM public.lite_tiers WHERE event_id=$1', [
      eventId,
    ])
  ).rows[0].id;
});
after(async () => {
  await pool.end();
});

test('ownership, draft privacy and guarded writes', async () => {
  assert.equal(
    (
      await asUser(null, 'SELECT id FROM public.lite_events WHERE id=$1', [
        eventId,
      ])
    ).rowCount,
    0,
  );
  assert.equal(
    (
      await asUser(stranger, 'SELECT id FROM public.lite_events WHERE id=$1', [
        eventId,
      ])
    ).rowCount,
    0,
  );
  await assert.rejects(
    asUser(stranger, "SELECT public.tc_transition_event($1,'publish')", [
      eventId,
    ]),
    /owner/,
  );
  await assert.rejects(
    asUser(owner, 'UPDATE public.lite_tiers SET available=100 WHERE id=$1', [
      tierId,
    ]),
    /permission/,
  );
  await assert.rejects(
    asUser(null, 'SELECT public.tc_book_event($1,$2::jsonb,$3)', [
      eventId,
      '[]',
      randomUUID(),
    ]),
    /permission/,
  );
  await assert.rejects(
    save({ ...payload, languages: ['Unknown'] }),
    /languages/,
  );
  await assert.rejects(
    save({
      ...payload,
      entryAt: new Date(Date.parse(payload.startsAt) - 90000000).toISOString(),
    }),
    /Entry/,
  );
  await asUser(owner, "SELECT public.tc_transition_event($1,'publish')", [
    eventId,
  ]);
});

test('twelve concurrent purchases cannot oversell three tickets', async () => {
  const attempts = await Promise.allSettled(
    Array.from({ length: 12 }, () => book(tierId)),
  );
  const paid = attempts.filter((attempt) => attempt.status === 'fulfilled');
  assert.equal(paid.length, 3);
  const orderId = paid[0].value.rows[0].id;
  assert.equal(
    (
      await asUser(stranger, 'SELECT id FROM public.lite_orders WHERE id=$1', [
        orderId,
      ])
    ).rowCount,
    0,
  );
  await assert.rejects(
    asUser(stranger, 'SELECT public.tc_refund_order($1)', [orderId]),
    /not found/,
  );
  await Promise.all(
    Array.from({ length: 5 }, () =>
      asUser(buyer, 'SELECT public.tc_refund_order($1)', [orderId]),
    ),
  );
  assert.equal(
    (
      await pool.query('SELECT available FROM public.lite_tiers WHERE id=$1', [
        tierId,
      ])
    ).rows[0].available,
    1,
  );
});

test('six concurrent retries book once and reject a changed payload', async () => {
  const key = randomUUID();
  const retries = await Promise.all(
    Array.from({ length: 6 }, () => book(tierId, key)),
  );
  assert.equal(new Set(retries.map((value) => value.rows[0].id)).size, 1);
  await assert.rejects(book(tierId, key, 2), /different tickets/);
  assert.equal(
    (
      await pool.query(
        'SELECT total_paise FROM public.lite_orders WHERE request_id=$1',
        [key],
      )
    ).rows[0].total_paise,
    12345,
  );
  assert.equal(
    (
      await pool.query(
        'SELECT count(*)::int AS n FROM public.lite_tickets WHERE order_id=$1',
        [retries[0].rows[0].id],
      )
    ).rows[0].n,
    1,
  );
});

test('sold prices are protected and removed tiers retain booking history', async () => {
  await assert.rejects(
    save({
      ...payload,
      tiers: [{ ...payload.tiers[0], id: tierId, pricePaise: 20000 }],
    }),
    /prices/,
  );
  await save({
    ...payload,
    tiers: [{ name: 'Front row', pricePaise: 20000, quantity: 2 }],
  });
  const tiers = (
    await pool.query('SELECT * FROM public.lite_tiers WHERE event_id=$1', [
      eventId,
    ])
  ).rows;
  assert.equal(tiers.find((tier) => tier.id === tierId).status, 'retired');
  newTierId = tiers.find((tier) => tier.status === 'active').id;
  await assert.rejects(book(tierId), /no longer/);
  assert.equal(
    (
      await asUser(null, 'SELECT id FROM public.lite_tiers WHERE id=$1', [
        tierId,
      ])
    ).rowCount,
    0,
  );
});

test('check-in is one-use and used tickets cannot be refunded or cancelled', async () => {
  const orderId = (await book(newTierId, randomUUID(), 2)).rows[0].id;
  const ticket = (
    await pool.query(
      'SELECT code FROM public.lite_tickets WHERE order_id=$1 LIMIT 1',
      [orderId],
    )
  ).rows[0];
  await assert.rejects(
    asUser(stranger, 'SELECT public.tc_check_in($1,$2)', [
      eventId,
      ticket.code,
    ]),
    /owner/,
  );
  await asUser(owner, 'SELECT public.tc_check_in($1,$2)', [
    eventId,
    ticket.code,
  ]);
  await assert.rejects(
    asUser(owner, 'SELECT public.tc_check_in($1,$2)', [eventId, ticket.code]),
    /already used/,
  );
  await assert.rejects(
    asUser(buyer, 'SELECT public.tc_refund_order($1)', [orderId]),
    /Used tickets/,
  );
  await assert.rejects(
    asUser(owner, "SELECT public.tc_transition_event($1,'cancel')", [eventId]),
    /checked-in/,
  );
  await assert.rejects(
    save({
      ...payload,
      tiers: [
        { name: 'Front row', id: newTierId, pricePaise: 20000, quantity: 1 },
      ],
    }),
    /Inventory/,
  );
});

test('reapplying migrations preserves tiers, issued tickets and stock', async () => {
  const before = (
    await pool.query(
      'SELECT id,available,status FROM public.lite_tiers WHERE event_id=$1 ORDER BY id',
      [eventId],
    )
  ).rows;
  const count = (
    await pool.query(
      'SELECT count(*)::int AS n FROM public.lite_tickets WHERE event_id=$1',
      [eventId],
    )
  ).rows[0].n;
  await applySchema();
  assert.deepEqual(
    (
      await pool.query(
        'SELECT id,available,status FROM public.lite_tiers WHERE event_id=$1 ORDER BY id',
        [eventId],
      )
    ).rows,
    before,
  );
  assert.equal(
    (
      await pool.query(
        'SELECT count(*)::int AS n FROM public.lite_tickets WHERE event_id=$1',
        [eventId],
      )
    ).rows[0].n,
    count,
  );
});
