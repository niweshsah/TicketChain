import pg from 'pg';
import { readFile } from 'node:fs/promises';

const url =
  process.env.TEST_DATABASE_URL ||
  'postgresql://postgres:local-lite-test-password@127.0.0.1:55433/ticketchain_lite_test';
if (!new URL(url).pathname.endsWith('_lite_test'))
  throw new Error('Tests require a database ending in _lite_test');
export const pool = new pg.Pool({ connectionString: url, max: 12 });
export async function applySchema() {
  await pool.query(
    await readFile(new URL('./storage-fixture.sql', import.meta.url), 'utf8'),
  );
  for (const file of [
    '01-schema.sql',
    '02-bookings.sql',
    '03-seed.sql',
    '04-ui-schema.sql',
    '05-ui-events.sql',
    '06-ui-booking.sql',
    '07-ui-account.sql',
  ]) {
    await pool.query(
      await readFile(new URL(`../supabase/${file}`, import.meta.url), 'utf8'),
    );
  }
  await pool.query("NOTIFY pgrst, 'reload schema'");
}
export async function asUser(user, query, values = []) {
  const connection = await pool.connect();
  try {
    await connection.query('BEGIN');
    await connection.query(`SET LOCAL ROLE ${user ? 'authenticated' : 'anon'}`);
    await connection.query(
      "SELECT set_config('request.jwt.claim.sub', $1, true)",
      [user || ''],
    );
    const result = await connection.query(query, values);
    await connection.query('COMMIT');
    return result;
  } catch (error) {
    await connection.query('ROLLBACK');
    throw error;
  } finally {
    connection.release();
  }
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  await applySchema();
  await pool.end();
  console.log('Lite test schema and seed are ready.');
}
