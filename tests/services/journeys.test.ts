import { randomUUID } from 'node:crypto';
import type { EventDto } from '@ticketchain/shared';
import { beforeAll, afterAll, it, expect } from 'vitest';

const base = process.env.SERVICE_TEST_BASE_URL || 'http://localhost:8080';
if (!['localhost', '127.0.0.1', 'web'].includes(new URL(base).hostname))
  throw new Error(
    'Service journeys run against the local demonstration stack only',
  );
interface Event {
  id: string;
  tiers: { id: string; name: string; available: number }[];
}
interface Order {
  id: string;
  status: string;
}
const events: string[] = [];
let organizer: string, attendee: string, other: string;
async function call<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  token?: string,
  key?: string,
) {
  const response = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      Origin: new URL(base).origin,
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: (await response.json()) as T };
}
async function account() {
  const result = await call<{ accessToken: string }>('/auth/register', 'POST', {
    name: 'Disposable service journey',
    email: `${randomUUID()}@service.test`,
    password: 'Service!Password2026',
    role: 'attendee',
  });
  expect(result.status).toBe(200);
  return result.data.accessToken;
}
async function createEvent(quantity = 3, waitingRoom = false, mixed = false) {
  const result = await call<Event>(
    '/organizer/events',
    'POST',
    {
      title: `Service journey ${randomUUID()}`,
      description: 'Disposable microservice verification data',
      category: 'Concert',
      performers: ['Fictional Test Band'],
      venueAddress: 'Fictional Test Road',
      languages: ['English'],
      agePolicy: '18+',
      venue: 'Verification hall',
      city: 'Bengaluru',
      timezone: 'UTC',
      imageUrl: 'https://example.com/concert.jpg',
      startsAt: new Date(Date.now() + 86400000).toISOString(),
      endsAt: new Date(Date.now() + 90000000).toISOString(),
      waitingRoom,
      tiers: [
        { name: 'General', pricePaise: 10000, quantity },
        ...(mixed ? [{ name: 'Balcony', pricePaise: 20000, quantity: 3 }] : []),
      ],
    },
    organizer,
  );
  expect(result.status).toBe(201);
  events.push(result.data.id);
  expect(
    (
      await call(
        `/organizer/events/${result.data.id}/publish`,
        'POST',
        {},
        organizer,
      )
    ).status,
  ).toBe(200);
  return result.data;
}
async function until<T>(
  read: () => Promise<T>,
  predicate: (value: T) => boolean,
): Promise<T> {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error('Service state did not converge within 30 seconds');
}
async function reserve(
  event: Event,
  quantity: number,
  token = attendee,
  key = randomUUID(),
  admissionPass?: string,
) {
  return call<Order>(
    '/orders',
    'POST',
    {
      eventId: event.id,
      currency: 'INR',
      items: [{ tierId: event.tiers[0].id, quantity }],
      ...(admissionPass ? { admissionPass } : {}),
    },
    token,
    key,
  );
}
beforeAll(async () => {
  organizer = await account();
  attendee = await account();
  other = await account();
  expect((await call('/me/organizer', 'POST', {}, organizer)).status).toBe(200);
});
afterAll(async () => {
  for (const id of events)
    await call(`/organizer/events/${id}/cancel`, 'POST', {}, organizer);
});

it('completes atomic holds, duplicate retries, asynchronous capture, tickets, and whole-order refunds through independent services', async () => {
  const event = await createEvent();
  const key = randomUUID();
  const purchase = await reserve(event, 2, attendee, key);
  expect(purchase.status).toBe(201);
  expect((await reserve(event, 2, attendee, key)).data.id).toBe(
    purchase.data.id,
  );
  expect((await reserve(event, 1, attendee, key)).status).toBe(409);
  expect((await reserve(event, 2, other)).status).toBe(409);
  expect(
    (await call<Event>(`/events/${event.id}`)).data.tiers[0].available,
  ).toBe(1);
  await call(
    '/payments/initialize',
    'POST',
    { orderId: purchase.data.id },
    attendee,
  );
  await until(
    () =>
      call<{ status: string }>(
        '/payments/initialize',
        'POST',
        { orderId: purchase.data.id },
        attendee,
      ),
    (response) => response.data.status === 'ready',
  );
  // Payment setup remains repeatable while Booking reports a valid hold.
  for (let retry = 0; retry < 10; retry++) {
    const setup = await call<{ status: string }>(
      '/payments/initialize',
      'POST',
      { orderId: purchase.data.id },
      attendee,
    );
    expect(setup.status).toBe(200);
    expect(setup.data.status).toBe('ready');
  }
  expect(
    (
      await call(
        '/payments/confirm',
        'POST',
        { orderId: purchase.data.id, scenario: 'success' },
        attendee,
      )
    ).status,
  ).toBe(200);
  await until(
    () =>
      call<Order>(`/orders/${purchase.data.id}`, 'GET', undefined, attendee),
    (response) => response.data.status === 'paid',
  );
  const tickets = await call<{ id: string; event_id: string }[]>(
    '/tickets',
    'GET',
    undefined,
    attendee,
  );
  const owned = tickets.data.filter((ticket) => ticket.event_id === event.id);
  expect(owned).toHaveLength(2);
  expect(
    (await call(`/tickets/${owned[0].id}/qr`, 'GET', undefined, other)).status,
  ).toBe(404);
  expect(
    (await call(`/orders/${purchase.data.id}/refund`, 'POST', {}, attendee))
      .status,
  ).toBe(200);
  expect(
    (await call(`/tickets/${owned[0].id}/qr`, 'GET', undefined, attendee))
      .status,
  ).toBe(404);
  await until(
    () =>
      call<Order>(`/orders/${purchase.data.id}`, 'GET', undefined, attendee),
    (response) => response.data.status === 'refunded',
  );
  expect(
    (await call<Event>(`/events/${event.id}`)).data.tiers[0].available,
  ).toBe(3);
});

it('requires a waiting-room pass and admits only available inventory under concurrent requests', async () => {
  const event = await createEvent(1, true);
  expect((await reserve(event, 1)).data).toMatchObject({
    code: 'WAITING_ROOM_REQUIRED',
  });
  const first = await call<{ state: string; pass: string }>(
    `/events/${event.id}/waiting-room`,
    'POST',
    { operation: 'join' },
    attendee,
  );
  const second = await call<{ state: string; pass: string }>(
    `/events/${event.id}/waiting-room`,
    'POST',
    { operation: 'join' },
    other,
  );
  expect(first.data.state).toBe('admitted');
  expect(second.data.state).toBe('admitted');
  const outcomes = await Promise.all([
    reserve(event, 1, attendee, randomUUID(), first.data.pass),
    reserve(event, 1, other, randomUUID(), second.data.pass),
  ]);
  expect(outcomes.map((result) => result.status).sort()).toEqual([201, 409]);
  expect(
    (await call<Event>(`/events/${event.id}`)).data.tiers[0].available,
  ).toBe(0);
});

it('projects published events into search and blocks internal service routes at the gateway', async () => {
  const event = await createEvent();
  await until(
    () =>
      call<{ events: Event[] }>(
        `/events?city=Bengaluru&q=Fictional%20Test%20Band&limit=100`,
      ),
    (response) => response.data.events.some((item) => item.id === event.id),
  );
  expect((await fetch(`${base}/internal/events`)).status).toBe(404);
  expect(
    (await call('/organizer/events', 'GET', undefined, attendee)).status,
  ).toBe(403);
});

it('keeps uncertain demo captures visible and cannot issue tickets through an ordinary retry', async () => {
  const event = await createEvent();
  const purchase = await reserve(event, 1);
  expect(purchase.status).toBe(201);
  await call(
    '/payments/initialize',
    'POST',
    { orderId: purchase.data.id },
    attendee,
  );
  await until(
    () =>
      call<{ status: string }>(
        '/payments/initialize',
        'POST',
        { orderId: purchase.data.id },
        attendee,
      ),
    (response) => response.data.status === 'ready',
  );
  await call(
    '/payments/confirm',
    'POST',
    { orderId: purchase.data.id, scenario: 'uncertain' },
    attendee,
  );
  await until(
    () =>
      call<Order & { financial_review: boolean }>(
        `/orders/${purchase.data.id}`,
        'GET',
        undefined,
        attendee,
      ),
    (response) => response.data.financial_review === true,
  );
  const retry = await call<{ status: string }>(
    '/payments/confirm',
    'POST',
    { orderId: purchase.data.id, scenario: 'success' },
    attendee,
  );
  expect(retry.data.status).toBe('payment_pending');
  const tickets = await call<{ event_id: string }[]>(
    '/tickets',
    'GET',
    undefined,
    attendee,
  );
  expect(tickets.data.some((ticket) => ticket.event_id === event.id)).toBe(
    false,
  );
});

it('stores processed avatars in shared storage and serves them through Identity replicas', async () => {
  const sharp = (await import('sharp')).default;
  const bytes = await sharp({
    create: { width: 700, height: 600, channels: 3, background: '#d72e85' },
  })
    .png()
    .withMetadata()
    .toBuffer();
  const uploaded = await fetch(`${base}/api/v1/me/avatar`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${attendee}`,
      'Content-Type': 'image/png',
    },
    body: new Uint8Array(bytes),
  });
  expect(uploaded.status).toBe(200);
  const user = (await uploaded.json()) as { avatarUrl: string };
  for (let i = 0; i < 8; i++) {
    const r = await fetch(`${base}${user.avatarUrl}`);
    expect(r.status).toBe(200);
    const metadata = await sharp(Buffer.from(await r.arrayBuffer())).metadata();
    expect(metadata.width).toBe(512);
    expect(metadata.exif).toBeUndefined();
  }
  const replacement = await fetch(`${base}/api/v1/me/avatar`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${attendee}`,
      'Content-Type': 'image/png',
    },
    body: new Uint8Array(bytes),
  });
  expect(replacement.status).toBe(200);
  const updated = (await replacement.json()) as { avatarUrl: string };
  expect(updated.avatarUrl).not.toBe(user.avatarUrl);
  expect((await fetch(`${base}${user.avatarUrl}`)).status).toBe(404);
  user.avatarUrl = updated.avatarUrl;
  const invalid = await fetch(`${base}/api/v1/me/avatar`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${attendee}`,
      'Content-Type': 'image/png',
    },
    body: 'invalid',
  });
  expect(invalid.status).toBe(400);
  expect(
    (await call<{ avatarUrl: string }>('/me', 'GET', undefined, attendee)).data
      .avatarUrl,
  ).toBe(user.avatarUrl);
  expect((await call('/me/avatar', 'DELETE', undefined, attendee)).status).toBe(
    200,
  );
});

it('projects only active tiers while a retired hold remains payable across services', async () => {
  const event = await createEvent(3, false, true);
  const hold = await reserve(event, 1);
  expect(hold.status).toBe(201);
  const e = (
    await call<EventDto>(
      `/organizer/events/${event.id}/preview`,
      'GET',
      undefined,
      organizer,
    )
  ).data;
  const active = e.tiers.slice(1);
  const saved = await call<EventDto>(
    `/organizer/events/${event.id}`,
    'PUT',
    {
      title: e.title,
      description: e.description,
      category: e.category,
      venue: e.venue,
      city: e.city,
      timezone: e.timezone,
      imageUrl: e.image_url,
      startsAt: e.starts_at,
      endsAt: e.ends_at,
      performers: e.performers,
      venueAddress: e.venue_address,
      languages: e.languages,
      agePolicy: e.age_policy,
      tiers: active.map((t) => ({
        id: t.id,
        name: t.name,
        pricePaise: t.price_paise,
        quantity: t.quantity,
      })),
    },
    organizer,
  );
  expect(saved.status).toBe(200);
  expect(saved.data.retired_tiers).toHaveLength(1);
  expect((await reserve(event, 1)).status).toBe(404);
  await until(
    () =>
      call<{ events: EventDto[] }>(`/events?q=${encodeURIComponent(e.title)}`),
    (r) =>
      r.data.events.some(
        (x) =>
          x.id === e.id &&
          x.tiers.length === 1 &&
          x.tiers[0].id === active[0].id,
      ),
  );
  await until(
    () =>
      call<{ status: string }>(
        '/payments/initialize',
        'POST',
        { orderId: hold.data.id },
        attendee,
      ),
    (r) => r.data.status === 'ready',
  );
  expect(
    (
      await call(
        '/payments/confirm',
        'POST',
        { orderId: hold.data.id, scenario: 'success' },
        attendee,
      )
    ).status,
  ).toBe(200);
  await until(
    () => call<Order>(`/orders/${hold.data.id}`, 'GET', undefined, attendee),
    (r) => r.data.status === 'paid',
  );
  expect(
    (await call(`/orders/${hold.data.id}/refund`, 'POST', {}, attendee)).status,
  ).toBe(200);
  await until(
    () => call<Order>(`/orders/${hold.data.id}`, 'GET', undefined, attendee),
    (r) => r.data.status === 'refunded',
  );
  expect((await reserve(event, 1)).status).toBe(404);
});
