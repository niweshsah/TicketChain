import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envFile = fileURLToPath(new URL('../.env.local', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);
const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key)
  throw new Error(
    'Configure the Supabase URL and publishable key in .env.local',
  );
if (key.startsWith('sb_secret_'))
  throw new Error('Use a publishable key, never a secret key');

async function request(path, body) {
  const response = await fetch(`${url}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { apikey: key, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  return { status: response.status, data: await response.json() };
}

const events = await request(
  '/rest/v1/lite_events?select=id,published&limit=100',
);
if (events.status !== 200 || !Array.isArray(events.data)) {
  throw new Error(
    `Event discovery failed: ${events.status} ${events.data.message || ''}`,
  );
}
if (events.data.some((event) => !event.published))
  throw new Error('Anonymous discovery exposed a draft');
console.log(`Discovery connected: ${events.data.length} public events`);

const settings = await request('/auth/v1/settings');
if (settings.status !== 200 || !settings.data.external?.email)
  throw new Error('Email authentication is unavailable');
console.log(
  `Email authentication connected; confirmation ${settings.data.mailer_autoconfirm ? 'disabled' : 'required'}`,
);

const orders = await request('/rest/v1/lite_orders?select=id&limit=1');
if (orders.data.code !== '42501' || ![401, 403].includes(orders.status)) {
  throw new Error(
    'Anonymous booking-history access was not denied as expected',
  );
}
console.log('Private booking history denies anonymous access');

// Null identifiers and inputs cannot create an event or change inventory.
const operations = {
  tc_save_event: { p_event_id: null, p_event: null },
  tc_transition_event: { p_event_id: null, p_action: null },
  tc_book_event: { p_event_id: null, p_items: null, p_request_id: null },
  tc_refund_order: { p_order_id: null },
  tc_check_in: { p_event_id: null, p_code: null },
  tc_attendees: { p_event_id: null },
  tc_summary: { p_event_id: null },
};
for (const [name, body] of Object.entries(operations)) {
  const response = await request(`/rest/v1/rpc/${name}`, body);
  if (response.data.code !== '42501' || ![401, 403].includes(response.status)) {
    throw new Error(
      `${name}: expected an installed function denying anonymous access, received ${response.status} ${response.data.message || ''}`,
    );
  }
  console.log(`${name}: installed and requires authentication`);
}
