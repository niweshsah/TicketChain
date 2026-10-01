import { oauthStartSchema, type OAuthProvider } from '@ticketchain/shared';
import { createHash, randomBytes } from 'node:crypto';
import { hash } from '../../../shared/crypto';
import { db } from '../../../shared/db';
import { assertRule } from '../../../shared/errors';
import { type Account } from '../../../shared/types';
import { credentials, endpoints, oauthCallbackUrl } from './providers';

export async function beginOAuth(
  provider: OAuthProvider,
  body: unknown,
  linkingUser?: Account,
) {
  const input = oauthStartSchema.parse(body);
  const client = credentials(provider);
  assertRule(
    client.id && client.secret,
    'OAUTH_UNAVAILABLE',
    'This sign-in provider is not configured',
    503,
  );
  assertRule(
    input.intent !== 'link' || linkingUser?.active,
    'UNAUTHORIZED',
    'Sign in before connecting an account',
    401,
  );
  const state = randomBytes(32).toString('base64url');
  const browserToken = randomBytes(32).toString('base64url');
  const verifier = randomBytes(48).toString('base64url');
  // Attempts are shared between replicas, short-lived and bound to this browser.
  await db.$executeRawUnsafe(
    'DELETE FROM tc_oauthattempt WHERE expires_at<now()',
  );
  await db.$executeRawUnsafe(
    "INSERT INTO tc_oauthattempt(state_hash,browser_hash,provider,verifier,role,link_user_id,expires_at) VALUES($1,$2,$3,$4,$5,$6::uuid,now()+interval '10 minutes')",
    hash(state),
    hash(browserToken),
    provider,
    verifier,
    input.role,
    input.intent === 'link' ? linkingUser!.id : null,
  );
  const url = new URL(endpoints[provider].authorize);
  url.search = new URLSearchParams({
    client_id: client.id!,
    redirect_uri: oauthCallbackUrl(provider),
    response_type: 'code',
    scope: endpoints[provider].scope,
    state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  }).toString();
  if (provider === 'google') url.searchParams.set('prompt', 'select_account');
  return { authorizationUrl: url.toString(), browserToken };
}
