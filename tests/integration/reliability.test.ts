import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { randomUUID, generateKeyPairSync, createHash, sign } from 'node:crypto';
import request from 'supertest';
import { config as dotenv } from 'dotenv';
dotenv();
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test'))
  throw new Error('TEST_DATABASE_URL must name a separate *_test database');
process.env.DATABASE_URL = url;
process.env.NODE_ENV = 'test';
process.env.PAYMENT_PROVIDER = 'demo';
process.env.JWT_SECRET ||= 'isolated-integration-test-secret-32-bytes';
process.env.WEB_ORIGIN = 'http://localhost:5173';
const modules = async () => ({
  auth: await import('../../apps/api/src/services/identity/auth'),
  events: await import('../../apps/api/src/services/booking/events'),
  orders: await import('../../apps/api/src/services/booking/orders'),
  providers: await import('../../apps/api/src/services/payments'),
  jobs: await import('../../apps/api/src/shared/infrastructure/jobs'),
  worker: await import('../../apps/api/src/shared/workers'),
  wallet: await import('../../apps/api/src/services/identity/wallet'),
  collectibles:
    await import('../../apps/api/src/services/booking/collectibles'),
  database: await import('../../apps/api/src/shared/db'),
  http: await import('../../apps/api/src/app'),
});
let m: Awaited<ReturnType<typeof modules>>;
type User = import('../../apps/api/src/shared/types').Account;
let organizer: User;
let attendee: User;
let other: User;
async function account(role: 'attendee' | 'organizer') {
  const s = await m.auth.register({
    name: 'Reliability test',
    email: `${randomUUID()}@test.local`,
    password: 'Reliable!Password123',
    role,
  });
  return (await m.database.one<User>(
    m.database.db,
    'SELECT * FROM tc_account WHERE id=$1::uuid',
    s.user.id,
  ))!;
}
async function event(quantity = 2, mixed = false) {
  const e = await m.events.saveEvent(organizer, {
    title: `Test concert ${randomUUID()}`,
    description: 'Disposable integration data',
    category: 'Concert',
    performers: ['Fictional Test Band'],
    venueAddress: 'Fictional Test Road',
    languages: ['English'],
    agePolicy: '18+',
    city: 'Bengaluru',
    venue: 'Test arena',
    timezone: 'Asia/Kolkata',
    imageUrl: 'https://example.com/concert.jpg',
    startsAt: new Date(Date.now() + 86400000).toISOString(),
    endsAt: new Date(Date.now() + 90000000).toISOString(),
    tiers: [
      { name: 'General', pricePaise: 10000, quantity },
      ...(mixed ? [{ name: 'VIP', pricePaise: 20000, quantity: 1 }] : []),
    ],
  });
  await m.events.transitionEvent(organizer, e.id, 'publish');
  return e;
}
async function reserve(
  e: Awaited<ReturnType<typeof event>>,
  user = attendee,
  key = randomUUID(),
  quantity = 1,
) {
  return m.orders.createOrder(
    user,
    { eventId: e.id, items: [{ tierId: e.tiers[0].id, quantity }] },
    key,
  );
}
async function capture(orderId: string, user = attendee) {
  const setup = await m.providers.initializePayment(user, orderId);
  await m.providers.runInitialize(setup.operationId);
  await m.providers.confirmPayment(user, { orderId, scenario: 'success' });
}
async function code(orderId: string) {
  return (await m.database.one<{ credential: string }>(
    m.database.db,
    'SELECT credential FROM tc_admissionticket WHERE order_id=$1::uuid',
    orderId,
  ))!.credential;
}
beforeAll(async () => {
  m = await modules();
  await m.database.db.$queryRawUnsafe('SELECT 1 FROM tc_account LIMIT 1');
  organizer = await account('organizer');
  attendee = await account('attendee');
  other = await account('organizer');
});
afterAll(async () => {
  await m?.database.db.$disconnect();
});
describe('PostgreSQL reliability', () => {
  it('prevents overselling under twenty concurrent requests', async () => {
    const e = await event(1);
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => reserve(e)),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await m.events.eventDetails(e.id)).tiers[0].available).toBe(0);
  });
  it('rolls mixed-tier allocation back entirely on insufficient inventory', async () => {
    const e = await event(2, true);
    const result = await m.orders
      .createOrder(
        attendee,
        {
          eventId: e.id,
          items: e.tiers.map((t) => ({ tierId: t.id, quantity: 2 })),
        },
        randomUUID(),
      )
      .catch((e) => e);
    expect(result.code).toBe('SOLD_OUT');
    const fresh = await m.events.eventDetails(e.id);
    expect(fresh.tiers.map((t) => t.available).sort()).toEqual([1, 2]);
  });
  it('returns identical retries and rejects changed payloads, with user scoped keys', async () => {
    const e = await event(5);
    const key = randomUUID();
    const a = await reserve(e, attendee, key);
    expect((await reserve(e, attendee, key)).id).toBe(a.id);
    await expect(reserve(e, attendee, key, 2)).rejects.toMatchObject({
      code: 'IDEMPOTENCY_MISMATCH',
    });
    expect((await reserve(e, other, key)).id).not.toBe(a.id);
  });
  it('reuses expired holds and retains old allocation history', async () => {
    const e = await event(1);
    const a = await reserve(e);
    await m.database.db.$executeRawUnsafe(
      "UPDATE tc_purchase SET expires_at=now()-interval '1 second' WHERE id=$1::uuid",
      a.id,
    );
    const b = await reserve(e);
    expect(b.id).not.toBe(a.id);
    const history = await m.database.rows(
      m.database.db,
      'SELECT * FROM tc_allocation WHERE order_id IN ($1::uuid,$2::uuid)',
      a.id,
      b.id,
    );
    expect(history).toHaveLength(2);
  });
  it('issues one ticket per unit despite duplicate confirmations', async () => {
    const e = await event(2);
    const a = await reserve(e, attendee, randomUUID(), 2);
    await capture(a.id);
    await Promise.all([
      capture(a.id).catch(() => undefined),
      m.providers.confirmPayment(attendee, { orderId: a.id }),
      m.providers.confirmPayment(attendee, { orderId: a.id }),
    ]);
    expect(
      await m.database.rows(
        m.database.db,
        'SELECT id FROM tc_admissionticket WHERE order_id=$1::uuid',
        a.id,
      ),
    ).toHaveLength(2);
  });
  it('reallocates a late captured payment in full if stock remains', async () => {
    const e = await event(1);
    const a = await reserve(e);
    const op = await m.providers.initializePayment(attendee, a.id);
    await m.providers.runInitialize(op.operationId);
    await m.database.db.$executeRawUnsafe(
      "UPDATE tc_purchase SET expires_at=now()-interval '1 second' WHERE id=$1::uuid",
      a.id,
    );
    await m.providers.confirmPayment(attendee, { orderId: a.id });
    expect((await m.orders.orderDetails(attendee.id, a.id)).status).toBe(
      'paid',
    );
  });
  it('queues a refund for late payment without enough stock', async () => {
    const e = await event(1);
    const a = await reserve(e);
    const op = await m.providers.initializePayment(attendee, a.id);
    await m.providers.runInitialize(op.operationId);
    await m.database.db.$executeRawUnsafe(
      "UPDATE tc_purchase SET expires_at=now()-interval '1 second' WHERE id=$1::uuid",
      a.id,
    );
    await reserve(e, other);
    await m.providers.confirmPayment(attendee, { orderId: a.id });
    expect((await m.orders.orderDetails(attendee.id, a.id)).status).toBe(
      'refund_pending',
    );
    expect(
      await m.database.rows(
        m.database.db,
        'SELECT id FROM tc_admissionticket WHERE order_id=$1::uuid',
        a.id,
      ),
    ).toHaveLength(0);
  });
  it('serializes refund versus check-in and never permits both', async () => {
    const e = await event(1);
    const a = await reserve(e);
    await capture(a.id);
    const credential = await code(a.id);
    const results = await Promise.allSettled([
      m.orders.requestRefund(attendee, a.id),
      m.orders.checkIn(organizer, e.id, credential),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });
  it('blocks admission on refund acceptance and restores stock only on confirmation', async () => {
    const e = await event(1);
    const a = await reserve(e);
    await capture(a.id);
    const credential = await code(a.id);
    await m.orders.requestRefund(attendee, a.id);
    expect((await m.events.eventDetails(e.id)).tiers[0].available).toBe(0);
    await expect(
      m.orders.checkIn(organizer, e.id, credential),
    ).rejects.toMatchObject({ code: 'ADMISSION_BLOCKED' });
    await m.providers.submitRefund(a.id);
    await m.orders.finishRefund(a.id);
    expect((await m.events.eventDetails(e.id)).tiers[0].available).toBe(1);
  });
  it('allows immediate single-use admission and scopes it to the owning organizer', async () => {
    const e = await event(1);
    const a = await reserve(e);
    await capture(a.id);
    const credential = await code(a.id);
    await expect(
      m.orders.checkIn(other, e.id, credential),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await m.orders.checkIn(organizer, e.id, credential);
    await expect(
      m.orders.checkIn(organizer, e.id, credential),
    ).rejects.toMatchObject({ code: 'ALREADY_USED' });
  });
  it('blocks cancellation admission immediately and sends partly used orders to review', async () => {
    const e = await event(2);
    const a = await reserve(e, attendee, randomUUID(), 2);
    await capture(a.id);
    await m.orders.checkIn(organizer, e.id, await code(a.id));
    await m.events.transitionEvent(organizer, e.id, 'cancel');
    await m.worker.processJob({
      id: randomUUID(),
      kind: 'cancel',
      payload: { eventId: e.id },
      attempts: 1,
      lease_owner: 'test',
    });
    expect((await m.orders.orderDetails(attendee.id, a.id)).status).toBe(
      'manual_review',
    );
    await expect(reserve(e)).rejects.toMatchObject({ code: 'SALES_CLOSED' });
  });
  it('revokes a refresh family on replay including its newest token', async () => {
    const s = await m.auth.login({
      email: attendee.email,
      password: 'Reliable!Password123',
    });
    const next = await m.auth.refresh(s.refreshToken);
    await expect(m.auth.refresh(s.refreshToken)).rejects.toMatchObject({
      code: 'REFRESH_REPLAY',
    });
    await expect(m.auth.refresh(next.refreshToken)).rejects.toMatchObject({
      code: 'REFRESH_REPLAY',
    });
  });
  it('recovers an abandoned durable job through lease expiry', async () => {
    const dedupe = `recovery:${randomUUID()}`;
    await m.jobs.enqueue(m.database.db, 'expire', dedupe, {
      eventId: (await event()).id,
    });
    const job = (await m.database.one<{ id: string }>(
      m.database.db,
      'SELECT id FROM tc_job WHERE dedupe=$1',
      dedupe,
    ))!;
    await m.database.db.$executeRawUnsafe(
      "UPDATE tc_job SET status='running',lease_owner='dead',lease_until=now()-interval '1 second',run_at=now()-interval '1 day' WHERE id=$1::uuid",
      job.id,
    );
    const recovered = await m.jobs.claimJob('replacement');
    expect(recovered?.id).toBe(job.id);
    await m.worker.processJob(recovered!);
    await m.jobs.finishJob(recovered!);
  });
  it('rejects unsigned wallet forgery and single-use challenge replay', async () => {
    const keys = generateKeyPairSync('ed25519');
    const rawKey = keys.publicKey
      .export({ type: 'spki', format: 'der' })
      .subarray(-32);
    const wallet = `0x${createHash('sha3-256')
      .update(Buffer.concat([rawKey, Buffer.from([0])]))
      .digest('hex')}`;
    const c = await m.wallet.walletChallenge(attendee, { wallet });
    const fullMessage = `APTOS\naddress: ${wallet}\napplication: http://localhost:5173\nchainId: 2\nmessage: ${c.message}\nnonce: ${c.id}`;
    const body = {
      challengeId: c.id,
      publicKey: rawKey.toString('hex'),
      signature: Buffer.alloc(64).toString('hex'),
      fullMessage,
    };
    await expect(m.wallet.linkWallet(attendee, body)).rejects.toMatchObject({
      code: 'WALLET_FORGERY',
    });
    body.signature = sign(
      null,
      Buffer.from(fullMessage),
      keys.privateKey,
    ).toString('hex');
    await m.wallet.linkWallet(attendee, body);
    await expect(m.wallet.linkWallet(attendee, body)).rejects.toMatchObject({
      code: 'CHALLENGE_EXPIRED',
    });
  });
  it('uses explicit DTOs, enforces origins, and hides the user directory', async () => {
    const result = await request(m.http.app)
      .post('/api/v1/auth/login')
      .set('Origin', 'http://localhost:5173')
      .send({ email: attendee.email, password: 'Reliable!Password123' });
    expect(result.status).toBe(200);
    expect(result.body.user.password_hash).toBeUndefined();
    expect(result.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(
      (
        await request(m.http.app)
          .post('/api/v1/auth/refresh')
          .set('Origin', 'https://evil.example')
      ).status,
    ).toBe(403);
    expect((await request(m.http.app).get('/api/v1/me')).status).toBe(401);
    expect(
      (
        await request(m.http.app)
          .get('/api/v1/users')
          .set('Authorization', `Bearer ${result.body.accessToken}`)
      ).status,
    ).toBe(404);
  });
  it('verifies captured Razorpay fixture amount, currency, and association', async () => {
    const e = await event();
    const a = await reserve(e);
    const order = (await m.database.one<
      import('../../apps/api/src/shared/types').Purchase
    >(m.database.db, 'SELECT * FROM tc_purchase WHERE id=$1::uuid', a.id))!;
    const payment = {
      id: 'pay_fixture',
      order_id: 'order_fixture',
      amount: 10000,
      currency: 'INR',
      status: 'captured',
      created_at: 1,
    };
    m.providers.validateCaptured(payment, order, 'order_fixture');
    expect(() =>
      m.providers.validateCaptured(
        { ...payment, amount: 1 },
        order,
        'order_fixture',
      ),
    ).toThrow();
    expect(() =>
      m.providers.validateCaptured(
        { ...payment, status: 'authorized' },
        order,
        'order_fixture',
      ),
    ).toThrow();
  });
});

describe('event editing and provider ordering', () => {
  it('freezes dates and sold tier prices while preserving order snapshots', async () => {
    const e = await event(3);
    const order = await reserve(e);
    await capture(order.id);
    const body = {
      title: 'Updated descriptive title',
      description: e.description,
      category: e.category,
      performers: e.performers,
      venueAddress: e.venue_address,
      languages: e.languages,
      agePolicy: e.age_policy,
      venue: e.venue,
      city: e.city,
      timezone: e.timezone,
      imageUrl: e.image_url,
      startsAt: e.starts_at.toISOString(),
      endsAt: e.ends_at.toISOString(),
      tiers: e.tiers.map((t) => ({
        id: t.id,
        name: 'Renamed tier',
        pricePaise: t.price_paise,
        quantity: 5,
      })),
    };
    await m.events.saveEvent(organizer, body, e.id);
    expect(
      (await m.orders.orderDetails(attendee.id, order.id)).items,
    ).toMatchObject([{ tier_name: 'General', price: 10000n }]);
    await expect(
      m.events.saveEvent(
        organizer,
        { ...body, startsAt: new Date(+e.starts_at + 1000).toISOString() },
        e.id,
      ),
    ).rejects.toMatchObject({ code: 'DATES_FROZEN' });
    await expect(
      m.events.saveEvent(
        organizer,
        {
          ...body,
          tiers: body.tiers.map((t) => ({ ...t, pricePaise: 20000 })),
        },
        e.id,
      ),
    ).rejects.toMatchObject({ code: 'PRICE_FROZEN' });
  });
  it('permits inventory retirement with history and rejects reductions below allocation', async () => {
    const e = await event(3);
    const a = await reserve(e);
    await capture(a.id);
    await m.orders.requestRefund(attendee, a.id);
    await m.providers.submitRefund(a.id);
    await m.orders.finishRefund(a.id);
    const body = {
      title: e.title,
      description: e.description,
      category: e.category,
      performers: e.performers,
      venueAddress: e.venue_address,
      languages: e.languages,
      agePolicy: e.age_policy,
      venue: e.venue,
      city: e.city,
      timezone: e.timezone,
      imageUrl: e.image_url,
      startsAt: e.starts_at.toISOString(),
      endsAt: e.ends_at.toISOString(),
      tiers: e.tiers.map((t) => ({
        id: t.id,
        name: t.name,
        pricePaise: t.price_paise,
        quantity: 1,
      })),
    };
    await m.events.saveEvent(organizer, body, e.id);
    expect((await m.events.eventDetails(e.id)).tiers[0].available).toBe(1);
    await reserve(e);
    await expect(reserve(e)).rejects.toMatchObject({ code: 'SOLD_OUT' });
    expect(
      await m.database.rows(
        m.database.db,
        'SELECT id FROM tc_allocation WHERE order_id=$1::uuid',
        a.id,
      ),
    ).toHaveLength(1);
  });
  it('does not regress a refunded order on older or duplicate captures', async () => {
    const e = await event(1);
    const a = await reserve(e);
    await capture(a.id);
    await m.orders.requestRefund(attendee, a.id);
    await m.providers.submitRefund(a.id);
    await m.orders.finishRefund(a.id);
    const op = (await m.database.one<{ id: string }>(
      m.database.db,
      "SELECT id FROM tc_provideroperation WHERE order_id=$1::uuid AND kind='payment'",
      a.id,
    ))!;
    await m.orders.fulfill(a.id, `demo_${op.id}`, 10000n, 'INR');
    expect((await m.orders.orderDetails(attendee.id, a.id)).status).toBe(
      'refunded',
    );
    expect(
      await m.database.rows(
        m.database.db,
        'SELECT id FROM tc_admissionticket WHERE order_id=$1::uuid',
        a.id,
      ),
    ).toHaveLength(1);
  });
  it('queues an extra captured payment for refund without extra admissions', async () => {
    const e = await event(1);
    const a = await reserve(e);
    await capture(a.id);
    await m.orders.fulfill(a.id, `extra_${randomUUID()}`, 10000n, 'INR');
    expect(
      await m.database.rows(
        m.database.db,
        'SELECT id FROM tc_admissionticket WHERE order_id=$1::uuid',
        a.id,
      ),
    ).toHaveLength(1);
    expect(
      await m.database.rows(
        m.database.db,
        "SELECT id FROM tc_provideroperation WHERE order_id=$1::uuid AND kind LIKE 'extra:%'",
        a.id,
      ),
    ).toHaveLength(1);
  });
  it('rejects captured transaction replay across different orders', async () => {
    const e = await event(2);
    const a = await reserve(e);
    const b = await reserve(e);
    await capture(a.id);
    const op = await m.providers.initializePayment(attendee, b.id);
    await m.providers.runInitialize(op.operationId);
    const paid = (await m.database.one<{ payment_id: string }>(
      m.database.db,
      "SELECT payment_id FROM tc_provideroperation WHERE order_id=$1::uuid AND kind='payment'",
      a.id,
    ))!;
    await expect(
      m.orders.fulfill(b.id, paid.payment_id, 10000n, 'INR'),
    ).rejects.toThrow();
    expect((await m.orders.orderDetails(attendee.id, b.id)).status).toBe(
      'held',
    );
  });
  it('serializes two concurrent refresh attempts and revokes the rotated family', async () => {
    const s = await m.auth.login({
      email: attendee.email,
      password: 'Reliable!Password123',
    });
    const results = await Promise.allSettled([
      m.auth.refresh(s.refreshToken),
      m.auth.refresh(s.refreshToken),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const success = results.find((r) => r.status === 'fulfilled');
    if (success?.status === 'fulfilled')
      await expect(
        m.auth.refresh(success.value.refreshToken),
      ).rejects.toMatchObject({ code: 'REFRESH_REPLAY' });
  });
});

describe('durable ingestion and collectible acceptance', () => {
  it('validates raw webhook HMAC and persists a single ingestion/job pair', async () => {
    const { config } = await import('../../apps/api/src/shared/config');
    const { createHmac } = await import('node:crypto');
    const priorProvider = config.PAYMENT_PROVIDER;
    const priorSecret = config.RAZORPAY_WEBHOOK_SECRET;
    config.PAYMENT_PROVIDER = 'razorpay';
    config.RAZORPAY_WEBHOOK_SECRET = 'fixture-webhook-secret';
    try {
      const eventId = `evt_${randomUUID()}`;
      const raw = Buffer.from(
        JSON.stringify({
          event: 'payment.captured',
          payload: { payment: { entity: { order_id: 'unknown-fixture' } } },
        }),
      );
      const signature = createHmac('sha256', config.RAZORPAY_WEBHOOK_SECRET)
        .update(raw)
        .digest('hex');
      await expect(
        m.providers.ingestWebhook(raw, '0'.repeat(64), eventId),
      ).rejects.toMatchObject({ code: 'INVALID_SIGNATURE' });
      await Promise.all([
        m.providers.ingestWebhook(raw, signature, eventId),
        m.providers.ingestWebhook(raw, signature, eventId),
      ]);
      expect(
        await m.database.rows(
          m.database.db,
          'SELECT id FROM tc_webhookevent WHERE id=$1',
          eventId,
        ),
      ).toHaveLength(1);
      expect(
        await m.database.rows(
          m.database.db,
          'SELECT id FROM tc_job WHERE dedupe=$1',
          `webhook:${eventId}`,
        ),
      ).toHaveLength(1);
    } finally {
      config.PAYMENT_PROVIDER = priorProvider;
      config.RAZORPAY_WEBHOOK_SECRET = priorSecret;
    }
  });
  it('deduplicates collectible claims and snapshots the original recipient', async () => {
    const { config } = await import('../../apps/api/src/shared/config');
    const prior = {
      treasury: config.APTOS_TREASURY,
      key: config.APTOS_PRIVATE_KEY,
      module: config.APTOS_MODULE,
    };
    config.APTOS_TREASURY = '0xcafe';
    config.APTOS_MODULE = '0xcafe';
    config.APTOS_PRIVATE_KEY = 'fixture-never-submitted';
    try {
      const e = await event();
      const a = await reserve(e);
      await capture(a.id);
      const ticket = (await m.database.one<{ id: string }>(
        m.database.db,
        'SELECT id FROM tc_admissionticket WHERE order_id=$1::uuid',
        a.id,
      ))!;
      const original = { ...attendee, wallet: '0x1' };
      const first = await m.collectibles.claimCollectible(original, ticket.id);
      const second = await m.collectibles.claimCollectible(
        { ...attendee, wallet: '0x2' },
        ticket.id,
      );
      expect(second.id).toBe(first.id);
      const record = (await m.database.one<{ recipient: string }>(
        m.database.db,
        'SELECT recipient FROM tc_claim WHERE id=$1::uuid',
        first.id,
      ))!;
      expect(record.recipient).toBe('0x1');
      await m.orders.requestRefund(attendee, a.id);
      await expect(
        m.collectibles.claimCollectible(original, ticket.id),
      ).rejects.toThrow();
    } finally {
      config.APTOS_TREASURY = prior.treasury;
      config.APTOS_PRIVATE_KEY = prior.key;
      config.APTOS_MODULE = prior.module;
    }
  });
  it('makes logout win against concurrent refresh-family rotation', async () => {
    const s = await m.auth.login({
      email: attendee.email,
      password: 'Reliable!Password123',
    });
    const results = await Promise.allSettled([
      m.auth.refresh(s.refreshToken),
      m.auth.logout(s.refreshToken),
    ]);
    const rotated = results[0];
    if (rotated.status === 'fulfilled')
      await expect(
        m.auth.refresh(rotated.value.refreshToken),
      ).rejects.toMatchObject({ code: 'REFRESH_REPLAY' });
  });
});

it('deletes unused tiers, retires tiers with holds, preserves payments and excludes refunded retired stock', async () => {
  const e = await event(2, true);
  const a = await reserve(e);
  const body = {
    title: e.title,
    description: e.description,
    category: e.category,
    city: e.city,
    venue: e.venue,
    timezone: e.timezone,
    imageUrl: e.image_url,
    startsAt: e.starts_at.toISOString(),
    endsAt: e.ends_at.toISOString(),
    performers: e.performers,
    venueAddress: e.venue_address,
    languages: e.languages,
    agePolicy: e.age_policy,
    tiers: e.tiers.slice(1).map((t) => ({
      id: t.id,
      name: t.name,
      pricePaise: t.price_paise,
      quantity: t.quantity,
    })),
  };
  await m.events.saveEvent(organizer, body, e.id);
  const detail = await m.events.eventDetails(e.id, organizer.id);
  expect(detail.tiers).toHaveLength(1);
  expect(detail.retired_tiers).toHaveLength(1);
  await expect(reserve(e)).rejects.toMatchObject({ code: 'TIER_INVALID' });
  await capture(a.id);
  expect((await m.orders.orderDetails(attendee.id, a.id)).status).toBe('paid');
  await m.orders.requestRefund(attendee, a.id);
  await m.providers.submitRefund(a.id);
  await m.orders.finishRefund(a.id);
  await expect(reserve(e)).rejects.toMatchObject({ code: 'TIER_INVALID' });
  const saved = await m.events.saveEvent(
    organizer,
    {
      ...body,
      tiers: [...body.tiers, { name: 'Unused', pricePaise: 5000, quantity: 2 }],
    },
    e.id,
  );
  const unused = saved.tiers.find((t) => t.name === 'Unused')!;
  await m.events.saveEvent(organizer, body, e.id);
  expect(
    await m.database.one(
      m.database.db,
      'SELECT id FROM tc_tier WHERE id=$1::uuid',
      unused.id,
    ),
  ).toBeUndefined();
});
it('serializes retirement with reservation, capture and organizer edits', async () => {
  const e = await event(2, true);
  const body = {
    title: e.title,
    description: e.description,
    category: e.category,
    city: e.city,
    venue: e.venue,
    timezone: e.timezone,
    imageUrl: e.image_url,
    startsAt: e.starts_at.toISOString(),
    endsAt: e.ends_at.toISOString(),
    performers: e.performers,
    venueAddress: e.venue_address,
    languages: e.languages,
    agePolicy: e.age_policy,
    tiers: e.tiers.slice(1).map((t) => ({
      id: t.id,
      name: t.name,
      pricePaise: t.price_paise,
      quantity: t.quantity,
    })),
  };
  const outcomes = await Promise.allSettled([
    reserve(e),
    m.events.saveEvent(organizer, body, e.id),
  ]);
  expect(outcomes[1].status).toBe('fulfilled');
  if (outcomes[0].status === 'fulfilled') await capture(outcomes[0].value.id);
  await expect(reserve(e)).rejects.toMatchObject({ code: 'TIER_INVALID' });
  expect(
    (await m.events.eventDetails(e.id)).tiers.some(
      (t) => t.id === e.tiers[0].id,
    ),
  ).toBe(false);
});

function remainingTierBody(e: Awaited<ReturnType<typeof event>>) {
  return {
    title: e.title,
    description: e.description,
    category: e.category,
    city: e.city,
    venue: e.venue,
    timezone: e.timezone,
    imageUrl: e.image_url,
    startsAt: e.starts_at.toISOString(),
    endsAt: e.ends_at.toISOString(),
    performers: e.performers,
    venueAddress: e.venue_address,
    languages: e.languages,
    agePolicy: e.age_policy,
    tiers: e.tiers.slice(1).map((t) => ({
      id: t.id,
      name: t.name,
      pricePaise: t.price_paise,
      quantity: t.quantity,
    })),
  };
}
it('serializes retirement with payment and refund without exposing restored retired inventory', async () => {
  const e = await event(2, true);
  const a = await reserve(e);
  await Promise.all([
    capture(a.id),
    m.events.saveEvent(organizer, remainingTierBody(e), e.id),
  ]);
  expect((await m.orders.orderDetails(attendee.id, a.id)).status).toBe('paid');
  await Promise.all([
    m.orders.requestRefund(attendee, a.id),
    m.events.saveEvent(organizer, remainingTierBody(e), e.id),
  ]);
  await m.providers.submitRefund(a.id);
  await m.orders.finishRefund(a.id);
  await expect(reserve(e)).rejects.toMatchObject({ code: 'TIER_INVALID' });
});
it('refunds expired holds when a late payment would need retired stock', async () => {
  const e = await event(1, true);
  const a = await reserve(e);
  const op = await m.providers.initializePayment(attendee, a.id);
  await m.providers.runInitialize(op.operationId);
  await m.events.saveEvent(organizer, remainingTierBody(e), e.id);
  await m.database.db.$executeRawUnsafe(
    "UPDATE tc_purchase SET expires_at=now()-interval '1 second' WHERE id=$1::uuid",
    a.id,
  );
  await m.providers.confirmPayment(attendee, { orderId: a.id });
  expect((await m.orders.orderDetails(attendee.id, a.id)).status).toBe(
    'refund_pending',
  );
});
it('refuses publication of incomplete legacy-style drafts', async () => {
  const e = await event(2, true);
  const draft = await m.events.saveEvent(organizer, {
    ...remainingTierBody(e),
    tiers: [{ name: 'Draft tier', pricePaise: 10000, quantity: 2 }],
    performers: [],
    venueAddress: '',
    languages: [],
    agePolicy: null,
  });
  await expect(
    m.events.transitionEvent(organizer, draft.id, 'publish'),
  ).rejects.toMatchObject({ code: 'PUBLICATION_INCOMPLETE' });
});
