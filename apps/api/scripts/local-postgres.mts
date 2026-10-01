import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
const databaseDir = '/tmp/ticketchain-postgres';
const pg = new EmbeddedPostgres({
  databaseDir,
  user: 'ticketchain',
  password: 'localdemo',
  port: 55432,
  persistent: true,
});
if (!existsSync(`${databaseDir}/PG_VERSION`)) await pg.initialise();
await pg.start();
const client = pg.getPgClient();
await client.connect();
for (const name of ['ticketchain_demo', 'ticketchain_test']) {
  const result = await client.query(
    'SELECT datname FROM pg_database WHERE datname=$1',
    [name],
  );
  if (!result.rowCount) await pg.createDatabase(name);
}
await client.end();
console.log('Isolated demo/test PostgreSQL ready on localhost:55432');
let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
setInterval(() => {}, 1000);
