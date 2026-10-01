import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
const execute = promisify(execFile);
const base = 'http://localhost:8080';
const evidence: { scenario: string; passed: boolean; durationMs: number }[] =
  [];
let token = '';
const created: string[] = [];

async function compose(...args: string[]) {
  await execute('docker', ['compose', ...args], {
    timeout: 60000,
    maxBuffer: 1024 * 1024,
  });
}
async function request<T>(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      Origin: base,
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(path === '/orders' ? { 'Idempotency-Key': randomUUID() } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const data = (await response.json()) as T;
  return { status: response.status, data };
}
async function waitFor(check: () => Promise<boolean>) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch {
      /* Dependencies may be restarting. */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Recovery deadline exceeded');
}
async function event(waitingRoom = false) {
  const result = await request<{ id: string; tiers: { id: string }[] }>(
    '/organizer/events',
    'POST',
    {
      title: `Failure drill ${randomUUID()}`,
      description: 'Disposable failure recovery demonstration',
      category: 'Concert',
      venue: 'Failure test hall',
      city: 'Failure City',
      timezone: 'UTC',
      imageUrl: 'https://example.com/concert.jpg',
      waitingRoom,
      startsAt: new Date(Date.now() + 86400000).toISOString(),
      endsAt: new Date(Date.now() + 90000000).toISOString(),
      tiers: [{ name: 'General', pricePaise: 10000, quantity: 2 }],
    },
  );
  if (result.status !== 201)
    throw new Error('Could not create disposable event');
  created.push(result.data.id);
  await request(`/organizer/events/${result.data.id}/publish`, 'POST', {});
  return result.data;
}
async function scenario(name: string, run: () => Promise<void>) {
  const start = performance.now();
  await run();
  evidence.push({
    scenario: name,
    passed: true,
    durationMs: performance.now() - start,
  });
}
async function main() {
  const account = await request<{ accessToken: string }>(
    '/auth/register',
    'POST',
    {
      name: 'Failure drill user',
      email: `${randomUUID()}@drill.test`,
      password: 'Failure!Password2026',
      role: 'organizer',
    },
  );
  if (account.status !== 200)
    throw new Error('Could not register disposable user');
  token = account.data.accessToken;
  const normal = await event(),
    queued = await event(true);
  const order = await request<{ id: string }>('/orders', 'POST', {
    eventId: normal.id,
    items: [{ tierId: normal.tiers[0].id, quantity: 1 }],
  });
  if (order.status !== 201) throw new Error('Reservation failed');
  await request('/payments/initialize', 'POST', { orderId: order.data.id });
  await waitFor(
    async () =>
      (
        await request<{ status: string }>('/payments/initialize', 'POST', {
          orderId: order.data.id,
        })
      ).data.status === 'ready',
  );
  try {
    await scenario(
      'captured payment survives Booking worker stop and RabbitMQ restart',
      async () => {
        await compose('stop', 'booking-worker');
        const confirmed = await request('/payments/confirm', 'POST', {
          orderId: order.data.id,
          scenario: 'success',
        });
        if (confirmed.status !== 200) throw new Error('Capture failed');
        await waitFor(async () => {
          const result = await execute('docker', [
            'compose',
            'exec',
            '-T',
            'rabbitmq',
            'rabbitmqctl',
            'list_queues',
            'name',
            'messages_ready',
            '--formatter=json',
          ]);
          const queues = JSON.parse(result.stdout) as {
            name: string;
            messages_ready: number;
          }[];
          return queues.some(
            (queue) =>
              queue.name === 'ticketchain.booking' &&
              Number(queue.messages_ready) > 0,
          );
        });
        await compose('restart', 'rabbitmq');
        await waitFor(async () => {
          await execute('docker', [
            'compose',
            'exec',
            '-T',
            'rabbitmq',
            'rabbitmq-diagnostics',
            '-q',
            'ping',
          ]);
          return true;
        });
        await compose('start', 'booking-worker');
        await waitFor(
          async () =>
            (await request<{ status: string }>(`/orders/${order.data.id}`)).data
              .status === 'paid',
        );
        const tickets = await request<{ event_id: string }[]>('/tickets');
        if (
          tickets.data.filter((ticket) => ticket.event_id === normal.id)
            .length !== 1
        )
          throw new Error('Capture issued an incorrect ticket count');
      },
    );
    await scenario(
      'Redis outage blocks queued reservations while existing orders remain readable',
      async () => {
        await compose('stop', 'redis');
        await waitFor(
          async () =>
            (
              await request(`/events/${queued.id}/waiting-room`, 'POST', {
                operation: 'join',
              })
            ).status === 503,
        );
        if ((await request(`/orders/${order.data.id}`)).status !== 200)
          throw new Error('Existing order became unavailable');
        await compose('start', 'redis');
        await waitFor(
          async () =>
            (
              await request(`/events/${queued.id}/waiting-room`, 'POST', {
                operation: 'join',
              })
            ).status === 200,
        );
      },
    );
    await scenario(
      'Elasticsearch outage uses the catalog database and recovers after restart',
      async () => {
        await waitFor(async () =>
          (
            await request<{ events: { id: string }[] }>(
              '/events?city=Failure%20City&limit=100',
            )
          ).data.events.some((item) => item.id === normal.id),
        );
        await compose('stop', 'elasticsearch');
        const search = await request<{ events: { id: string }[] }>(
          `/events?city=Failure%20City&limit=99&q=Failure`,
        );
        if (
          search.status !== 200 ||
          !search.data.events.some((item) => item.id === normal.id)
        )
          throw new Error('Catalog fallback failed');
        await compose('start', 'elasticsearch');
      },
    );
  } finally {
    await compose(
      'start',
      'rabbitmq',
      'redis',
      'elasticsearch',
      'booking-worker',
      'payments-worker',
      'catalog-worker',
    );
    for (const id of created)
      await request(`/organizer/events/${id}/cancel`, 'POST', {});
    mkdirSync('artifacts', { recursive: true });
    writeFileSync(
      'artifacts/failure-drill.json',
      JSON.stringify(
        { measuredAt: new Date().toISOString(), evidence },
        null,
        2,
      ) + '\n',
    );
  }
  console.log(JSON.stringify({ passed: evidence.length, evidence }));
}
void main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : 'Failure drill failed',
  );
  process.exitCode = 1;
});
