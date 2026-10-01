import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Client } from 'pg';
import { connectService, connectSource, inTransaction } from './database';

type Account = {
  id: string;
  name: string;
  email: string;
  active: boolean;
  role: string;
  avatar_key: string | null;
};

const isId = (value: string) =>
  /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
const removedName = 'Removed account';

export function removedEmail(id: string) {
  return `removed+${id}@invalid.local`;
}

async function account(
  client: Client,
  key: string,
): Promise<Account | undefined> {
  const result = isId(key)
    ? await client.query<Account>(
        'SELECT id,name,email,active,role,avatar_key FROM tc_account WHERE id=$1::uuid',
        [key],
      )
    : await client.query<Account>(
        'SELECT id,name,email,active,role,avatar_key FROM tc_account WHERE lower(email)=lower($1)',
        [key],
      );
  return result.rows[0];
}

async function count(client: Client, sql: string, id: string) {
  const result = await client.query<{ count: string }>(sql, [id]);
  return Number(result.rows[0].count);
}

export async function previewUser(key: string) {
  const [identity, booking, source] = await Promise.all([
    connectService('identity'),
    connectService('booking'),
    connectSource(),
  ]);
  try {
    const result = await account(identity, key);
    if (!result) throw new Error(`No Identity account matched ${key}`);
    const id = result.id;
    const sessions = await count(
      identity,
      'SELECT count(*)::text AS count FROM tc_session WHERE user_id=$1::uuid',
      id,
    );
    const linkedProviders = await count(
      identity,
      'SELECT count(*)::text AS count FROM tc_oauthidentity WHERE user_id=$1::uuid',
      id,
    );
    const purchases = await count(
      booking,
      'SELECT count(*)::text AS count FROM tc_purchase WHERE user_id=$1::uuid',
      id,
    );
    const events = await count(
      booking,
      'SELECT count(*)::text AS count FROM tc_listing WHERE owner_id=$1::uuid',
      id,
    );
    const [sourceCopy, bookingCopy] = await Promise.all([
      account(source, id),
      account(booking, id),
    ]);
    const statuses = await booking.query(
      'SELECT status,count(*)::int AS count FROM tc_purchase WHERE user_id=$1::uuid GROUP BY status ORDER BY status',
      [id],
    );
    return {
      id,
      name: result.name,
      email: result.email.replace(/^(.{2}).*(@.*)$/, '$1***$2'),
      active: result.active,
      sessions,
      linkedProviders,
      purchases,
      purchaseStatuses: statuses.rows,
      ownedBookingEvents: events,
      sourceCopy: copyStatus(sourceCopy, id),
      bookingCopy: copyStatus(bookingCopy, id),
    };
  } finally {
    await Promise.all([identity.end(), booking.end(), source.end()]);
  }
}

function copyStatus(value: Account | undefined, id: string) {
  return {
    exists: Boolean(value),
    active: value?.active,
    anonymized: Boolean(
      value &&
      !value.active &&
      value.name === removedName &&
      value.email === removedEmail(id),
    ),
  };
}

async function anonymize(client: Client, id: string) {
  await inTransaction(client, async () => {
    const current = await client.query<Account>(
      'SELECT id,name,email,active,role,avatar_key FROM tc_account WHERE id=$1::uuid FOR UPDATE',
      [id],
    );
    if (!current.rowCount) throw new Error(`Account ${id} is missing`);
    await client.query(
      `UPDATE tc_account
       SET name=$2,email=$3,password_hash=NULL,wallet=NULL,home_city=NULL,
           avatar_key=NULL,active=false,inactive_reason='account_anonymized'
       WHERE id=$1::uuid`,
      [id, removedName, removedEmail(id)],
    );
    await client.query(
      'UPDATE tc_session SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1::uuid',
      [id],
    );
    await client.query('DELETE FROM tc_oauthidentity WHERE user_id=$1::uuid', [
      id,
    ]);
    await client.query(
      'DELETE FROM tc_oauthattempt WHERE link_user_id=$1::uuid',
      [id],
    );
    await client.query(
      'DELETE FROM tc_walletchallenge WHERE user_id=$1::uuid',
      [id],
    );
    return current.rows[0].avatar_key;
  });
}

async function removeAvatarObject(key: string | null) {
  if (!key) return;
  const storage = new S3Client({
    endpoint: process.env.AVATAR_S3_ENDPOINT || 'http://localhost:9000',
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.AVATAR_S3_ACCESS_KEY || 'localavatars',
      secretAccessKey:
        process.env.AVATAR_S3_SECRET_KEY ||
        'local-avatar-storage-replace-in-production',
    },
  });
  try {
    await storage.send(
      new DeleteObjectCommand({
        Bucket: process.env.AVATAR_S3_BUCKET || 'avatars',
        Key: key,
      }),
    );
  } finally {
    storage.destroy();
  }
}

export async function anonymizeUser(id: string) {
  const [identity, booking, source] = await Promise.all([
    connectService('identity'),
    connectService('booking'),
    connectSource(),
  ]);
  try {
    const current = await account(identity, id);
    if (!current) throw new Error(`No Identity account matched ${id}`);
    const [identityAvatar, sourceAvatar] = await Promise.all([
      identity.query<{ avatar_key: string | null }>(
        'SELECT avatar_key FROM tc_account WHERE id=$1::uuid',
        [id],
      ),
      source.query<{ avatar_key: string | null }>(
        'SELECT avatar_key FROM tc_account WHERE id=$1::uuid',
        [id],
      ),
    ]);
    const avatarKeys = new Set(
      [
        identityAvatar.rows[0]?.avatar_key,
        sourceAvatar.rows[0]?.avatar_key,
      ].filter((key): key is string => Boolean(key)),
    );
    for (const key of avatarKeys) await removeAvatarObject(key);
    await Promise.all([
      anonymize(identity, id),
      anonymize(source, id),
      inTransaction(booking, async () => {
        const columns = await booking.query<{ column_name: string }>(
          `SELECT column_name FROM information_schema.columns
           WHERE table_schema='public' AND table_name='tc_account'
             AND column_name IN ('home_city','avatar_key')`,
        );
        const optional = columns.rows
          .map((column) => column.column_name)
          .map((column) => `,"${column}"=NULL`)
          .join('');
        const result = await booking.query(
          `UPDATE tc_account SET name=$2,email=$3,active=false,wallet=NULL${optional}
           WHERE id=$1::uuid`,
          [id, removedName, removedEmail(id)],
        );
        if (!result.rowCount)
          throw new Error(`Booking account copy ${id} is missing`);
      }),
    ]);
  } finally {
    await Promise.all([identity.end(), booking.end(), source.end()]);
  }
}
