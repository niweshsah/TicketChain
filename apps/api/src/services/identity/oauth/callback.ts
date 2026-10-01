import { type OAuthProvider } from '@ticketchain/shared';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { hash } from '../../../shared/crypto';
import { db, one, transaction } from '../../../shared/db';
import { assertRule, requireValue } from '../../../shared/errors';
import { type Account } from '../../../shared/types';
import { issueSession } from '../auth';
import { verifiedProfile } from './providers';

export interface OAuthAttempt {
  verifier: string;
  role: 'attendee' | 'organizer';
  link_user_id: string | null;
}

export async function completeOAuth(
  provider: OAuthProvider,
  query: unknown,
  browserToken?: string,
) {
  const callback = z
    .object({
      state: z.string().min(32).max(128),
      code: z.string().min(1).max(2048).optional(),
      error: z.string().max(200).optional(),
    })
    .parse(query);
  assertRule(
    browserToken,
    'OAUTH_STATE_INVALID',
    'Sign-in attempt expired or belongs to another browser',
    400,
  );
  // Consume atomically before external requests: the callback cannot be replayed.
  const attempt = await one<OAuthAttempt>(
    db,
    'UPDATE tc_oauthattempt SET consumed_at=now() WHERE state_hash=$1 AND browser_hash=$2 AND provider=$3 AND expires_at>now() AND consumed_at IS NULL RETURNING *',
    hash(callback.state),
    hash(browserToken),
    provider,
  );
  assertRule(
    attempt,
    'OAUTH_STATE_INVALID',
    'Sign-in attempt expired or was already used',
    400,
  );
  assertRule(
    !callback.error && callback.code,
    'OAUTH_DENIED',
    'Provider sign-in was cancelled or denied',
    401,
  );
  const profile = await verifiedProfile(
    provider,
    callback.code,
    attempt.verifier,
  );
  return transaction(async (tx) => {
    // Serialize identity creation/linking and competing providers with the same email.
    for (const key of [
      `oauth-identity:${provider}:${profile.subject}`,
      `oauth-email:${profile.email}`,
    ])
      await tx.$executeRawUnsafe(
        'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        key,
      );
    const identity = await one<{ user_id: string }>(
      tx,
      'SELECT user_id FROM tc_oauthidentity WHERE provider=$1 AND subject=$2',
      provider,
      profile.subject,
    );
    if (identity) {
      assertRule(
        !attempt.link_user_id || identity.user_id === attempt.link_user_id,
        'OAUTH_IDENTITY_IN_USE',
        'This provider account is already connected to another user',
      );
      const account = requireValue(
        await one<Account>(
          tx,
          'SELECT * FROM tc_account WHERE id=$1::uuid AND active',
          identity.user_id,
        ),
      );
      return issueSession(tx, account);
    }
    let account: Account;
    if (attempt.link_user_id) {
      account = requireValue(
        await one<Account>(
          tx,
          'SELECT * FROM tc_account WHERE id=$1::uuid AND active FOR UPDATE',
          attempt.link_user_id,
        ),
      );
      const existing = await one(
        tx,
        'SELECT id FROM tc_oauthidentity WHERE user_id=$1::uuid AND provider=$2',
        account.id,
        provider,
      );
      assertRule(
        !existing,
        'OAUTH_PROVIDER_ALREADY_LINKED',
        'A different account from this provider is already connected',
      );
    } else {
      const existing = await one(
        tx,
        'SELECT id FROM tc_account WHERE email=$1',
        profile.email,
      );
      // Verified email is insufficient to take over a password or other-provider account.
      assertRule(
        !existing,
        'OAUTH_LINK_REQUIRED',
        'Sign in with your existing method, then connect this provider from My tickets',
      );
      account = requireValue(
        await one<Account>(
          tx,
          'INSERT INTO tc_account(id,name,email,password_hash,role) VALUES($1::uuid,$2,$3,NULL,$4) RETURNING *',
          randomUUID(),
          profile.name,
          profile.email,
          attempt.role,
        ),
      );
    }
    await tx.$executeRawUnsafe(
      'INSERT INTO tc_oauthidentity(id,user_id,provider,subject) VALUES($1::uuid,$2::uuid,$3,$4)',
      randomUUID(),
      account.id,
      provider,
      profile.subject,
    );
    return issueSession(tx, account);
  });
}
