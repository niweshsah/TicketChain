import {
  registerSchema,
  loginSchema,
  type PublicUser,
} from '@ticketchain/shared';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { config } from '../../shared/config';
import { hash } from '../../shared/crypto';
import { db, one, transaction, type Tx } from '../../shared/db';
import { AppError, assertRule, requireValue } from '../../shared/errors';
import { type Account } from '../../shared/types';

export const publicUser = (account: Account): PublicUser => ({
  id: account.id,
  name: account.name,
  email: account.email,
  role: account.role,
  wallet: account.wallet,
  homeCity: (account.home_city as PublicUser['homeCity']) ?? null,
  avatarUrl: account.avatar_key
    ? `/api/v1/me/avatar/image/${account.avatar_key}`
    : null,
  capabilities:
    account.role === 'organizer' ? ['attendee', 'organizer'] : ['attendee'],
});

export async function issueSession(
  tx: Tx,
  account: Account,
  family: string = randomUUID(),
) {
  const refreshToken = randomBytes(48).toString('base64url');
  await tx.$executeRawUnsafe(
    "INSERT INTO tc_session(id,user_id,family,token_hash,expires_at) VALUES($1::uuid,$2::uuid,$3::uuid,$4,now()+interval '30 days')",
    randomUUID(),
    account.id,
    family,
    hash(refreshToken),
  );
  return {
    user: publicUser(account),
    accessToken: jwt.sign(
      { sub: account.id },
      config.JWT_PRIVATE_KEY_PATH
        ? readFileSync(config.JWT_PRIVATE_KEY_PATH)
        : config.JWT_SECRET,
      {
        algorithm: config.JWT_PRIVATE_KEY_PATH ? 'RS256' : 'HS256',
        expiresIn: '15m',
        issuer: 'ticketchain',
        audience: 'ticketchain-web',
      },
    ),
    refreshToken,
  };
}

export async function register(body: unknown) {
  const input = registerSchema.parse(body);
  const password = await bcrypt.hash(input.password, 12);
  return transaction(async (tx) => {
    const exists = await one(
      tx,
      'SELECT id FROM tc_account WHERE email=$1',
      input.email,
    );
    assertRule(!exists, 'EMAIL_EXISTS', 'Email already registered');
    const account = requireValue(
      await one<Account>(
        tx,
        'INSERT INTO tc_account(id,name,email,password_hash,role) VALUES($1::uuid,$2,$3,$4,$5) RETURNING *',
        randomUUID(),
        input.name,
        input.email,
        password,
        input.role,
      ),
    );
    return issueSession(tx, account);
  });
}

export async function login(body: unknown) {
  const input = loginSchema.parse(body);
  const account = await one<Account>(
    db,
    'SELECT * FROM tc_account WHERE email=$1 AND active',
    input.email,
  );
  if (
    !account ||
    !account.password_hash ||
    !(await bcrypt.compare(input.password, account.password_hash))
  )
    throw new AppError(
      401,
      'INVALID_CREDENTIALS',
      'Email or password is incorrect',
    );
  return transaction((tx) => issueSession(tx, account));
}

export async function refresh(token: string) {
  const outcome = await transaction(async (tx) => {
    const ref = await one<{ family: string }>(
      tx,
      'SELECT family FROM tc_session WHERE token_hash=$1',
      hash(token),
    );
    if (!ref) return null;
    await tx.$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
      ref.family,
    );
    const session = requireValue(
      await one<{
        id: string;
        user_id: string;
        family: string;
        revoked_at: Date | null;
        valid: boolean;
      }>(
        tx,
        'SELECT *,expires_at>now() AS valid FROM tc_session WHERE token_hash=$1 FOR UPDATE',
        hash(token),
      ),
    );
    if (session.revoked_at || !session.valid) {
      await tx.$executeRawUnsafe(
        'UPDATE tc_session SET revoked_at=now() WHERE family=$1::uuid',
        session.family,
      );
      return null;
    }
    const account = requireValue(
      await one<Account>(
        tx,
        'SELECT * FROM tc_account WHERE id=$1::uuid AND active',
        session.user_id,
      ),
    );
    await tx.$executeRawUnsafe(
      'UPDATE tc_session SET revoked_at=now() WHERE id=$1::uuid',
      session.id,
    );
    return issueSession(tx, account, session.family);
  });
  if (!outcome)
    throw new AppError(
      401,
      'REFRESH_REPLAY',
      'Session expired or reused; sign in again',
    );
  return outcome;
}

export async function logout(token: string) {
  await transaction(async (tx) => {
    const ref = await one<{ family: string }>(
      tx,
      'SELECT family FROM tc_session WHERE token_hash=$1',
      hash(token),
    );
    if (!ref) return;
    await tx.$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
      ref.family,
    );
    await tx.$executeRawUnsafe(
      'UPDATE tc_session SET revoked_at=now() WHERE family=$1::uuid',
      ref.family,
    );
  });
}
