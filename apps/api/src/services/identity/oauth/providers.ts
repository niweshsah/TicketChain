import { type OAuthProvider } from '@ticketchain/shared';
import { z } from 'zod';
import { config } from '../../../shared/config';
import { AppError, assertRule } from '../../../shared/errors';

export interface ProviderProfile {
  subject: string;
  email: string;
  name: string;
}

export const endpoints = {
  google: {
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
  },
  github: {
    authorize: 'https://github.com/login/oauth/authorize',
    token: 'https://github.com/login/oauth/access_token',
    scope: 'read:user user:email',
  },
};

export function credentials(provider: OAuthProvider) {
  return provider === 'google'
    ? { id: config.GOOGLE_CLIENT_ID, secret: config.GOOGLE_CLIENT_SECRET }
    : { id: config.GITHUB_CLIENT_ID, secret: config.GITHUB_CLIENT_SECRET };
}

export function availableOAuthProviders() {
  return {
    google: Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET),
    github: Boolean(config.GITHUB_CLIENT_ID && config.GITHUB_CLIENT_SECRET),
  };
}

export const oauthCallbackUrl = (provider: OAuthProvider) =>
  `${config.WEB_ORIGIN}/api/v1/auth/oauth/${provider}/callback`;

export async function providerJson(url: string, options: RequestInit) {
  try {
    const response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
    });
    if (!response.ok) throw new Error('Provider rejected request');
    return (await response.json()) as unknown;
  } catch {
    throw new AppError(
      502,
      'OAUTH_PROVIDER_FAILED',
      'Sign-in provider could not be reached; please try again',
    );
  }
}

export async function verifiedProfile(
  provider: OAuthProvider,
  code: string,
  verifier: string,
): Promise<ProviderProfile> {
  const client = credentials(provider);
  const token = z
    .object({ access_token: z.string().min(1), token_type: z.string() })
    .safeParse(
      await providerJson(endpoints[provider].token, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: client.id!,
          client_secret: client.secret!,
          code,
          redirect_uri: oauthCallbackUrl(provider),
          grant_type: 'authorization_code',
          code_verifier: verifier,
        }).toString(),
      }),
    );
  assertRule(
    token.success && token.data.token_type.toLowerCase() === 'bearer',
    'OAUTH_PROVIDER_FAILED',
    'Provider authorization failed',
    401,
  );
  const headers = {
    Authorization: `Bearer ${token.data.access_token}`,
    Accept: 'application/json',
  };
  if (provider === 'google') {
    // The access token comes from our server-side code exchange, never the browser.
    const profile = z
      .object({
        sub: z.string().min(1).max(255),
        email: z.string().email(),
        email_verified: z.literal(true),
        name: z.string().optional(),
      })
      .safeParse(
        await providerJson('https://openidconnect.googleapis.com/v1/userinfo', {
          headers,
        }),
      );
    assertRule(
      profile.success,
      'OAUTH_EMAIL_UNVERIFIED',
      'Google must provide a verified email address',
      401,
    );
    return {
      subject: profile.data.sub,
      email: profile.data.email.toLowerCase(),
      name: (profile.data.name || profile.data.email.split('@')[0]).slice(
        0,
        100,
      ),
    };
  }
  const githubHeaders = {
    ...headers,
    'User-Agent': 'TicketChain',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const profile = z
    .object({
      id: z.number().int().positive().safe(),
      login: z.string().min(1),
      name: z.string().nullable(),
    })
    .parse(
      await providerJson('https://api.github.com/user', {
        headers: githubHeaders,
      }),
    );
  // Public profile email may be absent or unverified. Use the authenticated emails endpoint.
  const emails = z
    .array(
      z.object({
        email: z.string().email(),
        verified: z.boolean(),
        primary: z.boolean(),
      }),
    )
    .parse(
      await providerJson('https://api.github.com/user/emails', {
        headers: githubHeaders,
      }),
    );
  const email = emails.find((entry) => entry.primary && entry.verified);
  assertRule(
    email,
    'OAUTH_EMAIL_UNVERIFIED',
    'GitHub must provide a verified primary email address',
    401,
  );
  return {
    subject: String(profile.id),
    email: email.email.toLowerCase(),
    name: (profile.name || profile.login).slice(0, 100),
  };
}
