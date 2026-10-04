import { createHmac } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { applySchema, pool } from './database.js';

// Fixtures only. This signing secret is never used by the hosted application.
const integration = process.argv.includes('--integration');
const siteUrl = integration ? 'http://localhost:4185' : 'http://localhost:4175';
const envPath = new URL(
  integration ? '../.env.integration.local' : '../.env.local',
  import.meta.url,
);
const previous = await readFile(envPath, 'utf8').catch(() => '');
if (previous && !previous.includes(siteUrl)) {
  throw new Error(
    'Preserving existing hosted configuration. Move .env.local before local testing.',
  );
}
try {
  await applySchema();
  // PostgREST reloads its schema asynchronously after the notification.
  let ready = false;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetch(
      'http://127.0.0.1:55442/lite_events?select=id',
    ).catch(() => null);
    if (response?.ok) {
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error('Local API did not become ready');
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ role: 'anon', iss: 'supabase', exp: Math.floor(Date.now() / 1000) + 86400 })}`;
  const signature = createHmac(
    'sha256',
    'local-lite-tests-only-signing-secret-at-least-32-characters',
  )
    .update(unsigned)
    .digest('base64url');
  await writeFile(
    envPath,
    `VITE_SUPABASE_URL=${siteUrl}\nVITE_SUPABASE_PUBLISHABLE_KEY=${unsigned}.${signature}\n`,
  );
  console.log('Local fixture configuration is ready; start npm run dev.');
} finally {
  await pool.end();
}
