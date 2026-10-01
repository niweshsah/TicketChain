import { hash } from '../../apps/api/src/shared/crypto';
import {
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
  it,
  expect,
  vi,
} from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import { config as loadEnvironment } from 'dotenv';
loadEnvironment();
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl || !new URL(testUrl).pathname.endsWith('_test'))
  throw new Error('OAuth tests require a separate *_test database');
process.env.DATABASE_URL = testUrl;
process.env.NODE_ENV = 'test';
process.env.PAYMENT_PROVIDER = 'demo';
process.env.JWT_SECRET ||= 'isolated-oauth-test-secret-at-least-32-characters';
process.env.WEB_ORIGIN = 'http://localhost:5173';
// Fixture credentials are never sent to live providers.
process.env.GOOGLE_CLIENT_ID = 'google-fixture-client';
process.env.GOOGLE_CLIENT_SECRET = 'google-fixture-secret';
process.env.GITHUB_CLIENT_ID = 'github-fixture-client';
process.env.GITHUB_CLIENT_SECRET = 'github-fixture-secret';
let oauth: typeof import('../../apps/api/src/services/identity/oauth');
let auth: typeof import('../../apps/api/src/services/identity/auth');
let database: typeof import('../../apps/api/src/shared/db');
let app: typeof import('../../apps/api/src/app').app;
let googleProfile: {
  sub: string;
  email: string;
  email_verified: boolean;
  name: string;
};
let githubSubject: number;
let githubEmails: { email: string; verified: boolean; primary: boolean }[];
let providerFetch: ReturnType<typeof vi.fn>;
beforeAll(async () => {
  oauth = await import('../../apps/api/src/services/identity/oauth');
  auth = await import('../../apps/api/src/services/identity/auth');
  database = await import('../../apps/api/src/shared/db');
  app = (await import('../../apps/api/src/app')).app;
});
beforeEach(() => {
  googleProfile = {
    sub: randomUUID(),
    email: `${randomUUID()}@oauth.test`,
    email_verified: true,
    name: 'OAuth fixture user',
  };
  githubSubject = parseInt(randomUUID().replaceAll('-', '').slice(0, 12), 16);
  githubEmails = [
    { email: `${randomUUID()}@oauth.test`, verified: true, primary: true },
  ];
  providerFetch = vi.fn(async (url: string) => {
    if (url.endsWith('/token') || url.endsWith('/access_token'))
      return Response.json({
        access_token: 'fixture-access-token',
        token_type: 'Bearer',
      });
    if (url.endsWith('/userinfo')) return Response.json(googleProfile);
    if (url.endsWith('/user/emails')) return Response.json(githubEmails);
    if (url.endsWith('/user'))
      return Response.json({
        id: githubSubject,
        login: 'fixture-github',
        name: null,
        email: null,
      });
    throw new Error('Unexpected fixture endpoint');
  });
  vi.stubGlobal('fetch', providerFetch);
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => database.db.$disconnect());
async function attempt(
  provider: 'google' | 'github' = 'google',
  role: 'attendee' | 'organizer' = 'attendee',
  user?: import('../../apps/api/src/shared/types').Account,
) {
  const start = await oauth.beginOAuth(
    provider,
    { role, intent: user ? 'link' : 'login' },
    user,
  );
  const state = new URL(start.authorizationUrl).searchParams.get('state')!;
  return { ...start, state };
}
async function complete(
  start: Awaited<ReturnType<typeof attempt>>,
  provider: 'google' | 'github' = 'google',
) {
  return oauth.completeOAuth(
    provider,
    { state: start.state, code: 'fixture-code' },
    start.browserToken,
  );
}
async function passwordUser() {
  const session = await auth.register({
    name: 'Password fixture',
    email: googleProfile.email,
    password: 'Reliable!Password123',
    role: 'attendee',
  });
  return (await database.one<import('../../apps/api/src/shared/types').Account>(
    database.db,
    'SELECT * FROM tc_account WHERE id=$1::uuid',
    session.user.id,
  ))!;
}
it('creates a browser-bound PKCE attempt and keeps secrets out of the start response', async () => {
  const response = await request(app)
    .post('/api/v1/auth/oauth/google/start')
    .set('Origin', 'http://localhost:5173')
    .send({ role: 'organizer' });
  expect(response.status).toBe(200);
  expect(Object.keys(response.body)).toEqual(['authorizationUrl']);
  const url = new URL(response.body.authorizationUrl);
  expect(url.origin).toBe('https://accounts.google.com');
  expect(url.searchParams.get('redirect_uri')).toBe(
    'http://localhost:5173/api/v1/auth/oauth/google/callback',
  );
  const saved = (await database.one<{ verifier: string; role: string }>(
    database.db,
    'SELECT verifier,role FROM tc_oauthattempt WHERE state_hash=$1',
    hash(url.searchParams.get('state')!),
  ))!;
  expect(saved.role).toBe('organizer');
  expect(url.searchParams.get('code_challenge')).toBe(
    createHash('sha256').update(saved.verifier).digest('base64url'),
  );
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  expect(response.headers['set-cookie'][0]).toMatch(/HttpOnly/);
  expect(response.headers['set-cookie'][0]).toMatch(/SameSite=Lax/);
  expect(providerFetch).not.toHaveBeenCalled();
});
it('rejects bad origins, privileged registration roles and unauthenticated linking', async () => {
  expect(
    (
      await request(app)
        .post('/api/v1/auth/oauth/github/start')
        .set('Origin', 'https://attacker.test')
        .send({})
    ).status,
  ).toBe(403);
  expect(
    (
      await request(app)
        .post('/api/v1/auth/oauth/github/start')
        .set('Origin', 'http://localhost:5173')
        .send({ role: 'admin' })
    ).status,
  ).toBe(400);
  expect(
    (
      await request(app)
        .post('/api/v1/auth/oauth/github/start')
        .set('Origin', 'http://localhost:5173')
        .send({ intent: 'link' })
    ).status,
  ).toBe(401);
});
it('redirects a successful callback without exposing access tokens and rotates the normal session', async () => {
  const start = await attempt('google', 'organizer');
  const response = await request(app)
    .get('/api/v1/auth/oauth/google/callback')
    .query({ state: start.state, code: 'fixture-code' })
    .set('Cookie', `tc_oauth_google=${start.browserToken}`);
  expect(response.status).toBe(303);
  expect(response.headers.location).toBe(
    'http://localhost:5173/organizer?oauth=connected',
  );
  expect(response.headers.location).not.toContain('token');
  const refreshCookie = response.headers['set-cookie']
    .find((value: string) => value.startsWith('tc_refresh='))!
    .split(';')[0];
  const session = await request(app)
    .post('/api/v1/auth/refresh')
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', refreshCookie);
  expect(session.status).toBe(200);
  expect(session.body.user.role).toBe('organizer');
  const account = await database.one<{ password_hash: null }>(
    database.db,
    'SELECT password_hash FROM tc_account WHERE id=$1::uuid',
    session.body.user.id,
  );
  expect(account?.password_hash).toBeNull();
  await expect(
    auth.login({ email: googleProfile.email, password: 'NotARealPassword123' }),
  ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
});
it('allows exactly one concurrent callback and never exchanges a replayed code', async () => {
  const start = await attempt();
  const results = await Promise.allSettled([complete(start), complete(start)]);
  expect(results.filter((entry) => entry.status === 'fulfilled')).toHaveLength(
    1,
  );
  expect(providerFetch).toHaveBeenCalledTimes(2);
  await expect(complete(start)).rejects.toMatchObject({
    code: 'OAUTH_STATE_INVALID',
  });
  expect(providerFetch).toHaveBeenCalledTimes(2);
});
it('rejects wrong browsers, swapped providers and expired attempts before exchange', async () => {
  const start = await attempt();
  await expect(
    oauth.completeOAuth(
      'google',
      { state: start.state, code: 'fixture' },
      'wrong-browser',
    ),
  ).rejects.toMatchObject({ code: 'OAUTH_STATE_INVALID' });
  await expect(complete(start, 'github')).rejects.toMatchObject({
    code: 'OAUTH_STATE_INVALID',
  });
  await database.db.$executeRawUnsafe(
    "UPDATE tc_oauthattempt SET expires_at=now()-interval '1 second' WHERE state_hash=$1",
    hash(start.state),
  );
  await expect(complete(start)).rejects.toMatchObject({
    code: 'OAUTH_STATE_INVALID',
  });
  expect(providerFetch).not.toHaveBeenCalled();
});
it('handles denial as a consumed attempt and returns a safe browser error', async () => {
  const start = await attempt();
  const response = await request(app)
    .get('/api/v1/auth/oauth/google/callback')
    .query({
      state: start.state,
      error: 'access_denied',
      error_description: 'untrusted provider text',
    })
    .set('Cookie', `tc_oauth_google=${start.browserToken}`);
  expect(response.headers.location).toBe(
    'http://localhost:5173/login?oauthError=OAUTH_DENIED',
  );
  expect(providerFetch).not.toHaveBeenCalled();
  await expect(complete(start)).rejects.toMatchObject({
    code: 'OAUTH_STATE_INVALID',
  });
});
it('requires verified Google and verified primary GitHub email addresses', async () => {
  googleProfile.email_verified = false;
  await expect(complete(await attempt())).rejects.toMatchObject({
    code: 'OAUTH_EMAIL_UNVERIFIED',
  });
  githubEmails[0].verified = false;
  await expect(
    complete(await attempt('github'), 'github'),
  ).rejects.toMatchObject({ code: 'OAUTH_EMAIL_UNVERIFIED' });
});
it('supports private GitHub email via the authenticated email endpoint and sends PKCE on exchange', async () => {
  const start = await attempt('github');
  const session = await complete(start, 'github');
  expect(session.user.email).toBe(githubEmails[0].email);
  const tokenCall = providerFetch.mock.calls[0];
  const options = tokenCall[1] as RequestInit;
  expect(
    new URLSearchParams(String(options.body)).get('code_verifier'),
  ).toBeTruthy();
  expect(new URLSearchParams(String(options.body)).get('redirect_uri')).toBe(
    'http://localhost:5173/api/v1/auth/oauth/github/callback',
  );
  expect(providerFetch.mock.calls.map((call) => call[0])).toContain(
    'https://api.github.com/user/emails',
  );
});
it('prevents email-based takeover and permits explicit linking to the authenticated account', async () => {
  const account = await passwordUser();
  await expect(complete(await attempt())).rejects.toMatchObject({
    code: 'OAUTH_LINK_REQUIRED',
  });
  const linked = await complete(await attempt('google', 'organizer', account));
  expect(linked.user.id).toBe(account.id);
  expect(linked.user.role).toBe('attendee');
  const nextLogin = await complete(await attempt('google', 'organizer'));
  expect(nextLogin.user.id).toBe(account.id);
  expect(nextLogin.user.role).toBe('attendee');
});
it('uses provider subject for returning users even if their email changes', async () => {
  const first = await complete(await attempt());
  googleProfile.email = `${randomUUID()}@changed.test`;
  const second = await complete(await attempt('google', 'organizer'));
  expect(second.user.id).toBe(first.user.id);
  expect(second.user.role).toBe('attendee');
});
it('rejects linking an identity owned by another user or replacing an existing provider', async () => {
  await complete(await attempt());
  googleProfile.email = `${randomUUID()}@oauth.test`;
  const other = await passwordUser();
  await expect(
    complete(await attempt('google', 'attendee', other)),
  ).rejects.toMatchObject({ code: 'OAUTH_IDENTITY_IN_USE' });
  googleProfile.sub = randomUUID();
  await complete(await attempt('google', 'attendee', other));
  googleProfile.sub = randomUUID();
  await expect(
    complete(await attempt('google', 'attendee', other)),
  ).rejects.toMatchObject({ code: 'OAUTH_PROVIDER_ALREADY_LINKED' });
});
it('keeps provider failures generic and prevents replay after an uncertain exchange', async () => {
  providerFetch.mockRejectedValue(new Error('secret upstream details'));
  const start = await attempt();
  await expect(complete(start)).rejects.toMatchObject({
    code: 'OAUTH_PROVIDER_FAILED',
  });
  await expect(complete(start)).rejects.toMatchObject({
    code: 'OAUTH_STATE_INVALID',
  });
});

it('reports unavailable providers without exposing configuration secrets', async () => {
  const { config } = await import('../../apps/api/src/shared/config');
  const original = {
    id: config.GOOGLE_CLIENT_ID,
    secret: config.GOOGLE_CLIENT_SECRET,
  };
  config.GOOGLE_CLIENT_ID = undefined;
  config.GOOGLE_CLIENT_SECRET = undefined;
  try {
    const response = await request(app).get('/api/v1/auth/providers');
    expect(response.body).toEqual({ google: false, github: true });
    await expect(oauth.beginOAuth('google', {})).rejects.toMatchObject({
      code: 'OAUTH_UNAVAILABLE',
    });
    expect(providerFetch).not.toHaveBeenCalled();
  } finally {
    config.GOOGLE_CLIENT_ID = original.id;
    config.GOOGLE_CLIENT_SECRET = original.secret;
  }
});
