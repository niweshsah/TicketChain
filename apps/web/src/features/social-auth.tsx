import { useState } from 'react';
import { useSearchParams, useLocation } from 'react-router-dom';
import type { OAuthProvider } from '@ticketchain/shared';
import { ticketApi as api } from '../store';
import { Notice } from './feedback';

const callbackErrors: Record<string, string> = {
  OAUTH_LINK_REQUIRED:
    'An account already uses this email. Sign in with your existing method, then connect the provider from My tickets.',
  OAUTH_STATE_INVALID:
    'This sign-in attempt expired or was already used. Please start again.',
  OAUTH_DENIED:
    'Provider sign-in was cancelled. You can try again or use email and password.',
  OAUTH_EMAIL_UNVERIFIED:
    'Your provider must supply a verified email address before you can sign in.',
  OAUTH_IDENTITY_IN_USE:
    'That provider account is connected to another TicketChain account.',
  OAUTH_PROVIDER_ALREADY_LINKED:
    'A different account from this provider is already connected.',
};
export function SocialAuth({
  role = 'attendee',
  linking = false,
}: {
  role?: 'attendee' | 'organizer';
  linking?: boolean;
}) {
  const providers = api.useOauthProvidersQuery();
  const [start, mutation] = api.useStartOAuthMutation();
  const [redirecting, setRedirecting] = useState(false);
  const [params] = useSearchParams();
  const location = useLocation();
  async function signIn(provider: OAuthProvider) {
    try {
      const result = await start({
        provider,
        body: { role, intent: linking ? 'link' : 'login' },
      }).unwrap();
      setRedirecting(true);
      const target = linking ? location.pathname : params.get('returnTo');
      if (target?.startsWith('/') && !target.startsWith('//'))
        sessionStorage.setItem('oauthReturnTo', target);
      window.location.assign(result.authorizationUrl);
    } catch {
      // The error remains visible; email/password form values are retained.
    }
  }
  const errorCode = params.get('oauthError');
  const available = providers.data?.google || providers.data?.github;
  return (
    <div className="social-auth">
      {linking && <h2>Connected sign-in</h2>}
      <p className="muted">
        {linking
          ? 'Connect a provider to sign in to this same account next time.'
          : 'Or continue with your existing account'}
      </p>
      <div className="social-buttons">
        {(['google', 'github'] as const).map((provider) => (
          <button
            key={provider}
            type="button"
            disabled={
              !providers.data?.[provider] || mutation.isLoading || redirecting
            }
            onClick={() => void signIn(provider)}
          >
            {linking ? 'Connect' : 'Continue with'}{' '}
            {provider === 'google' ? 'Google' : 'GitHub'}
          </button>
        ))}
      </div>
      {providers.isLoading && <p role="status">Checking sign-in options…</p>}
      {!providers.isLoading && !available && !providers.error && (
        <p className="muted">
          Google and GitHub sign-in require OAuth credentials in this
          environment. Email/password sign-in remains available.
        </p>
      )}
      <Notice error={providers.error || mutation.error} />
      {errorCode && (
        <Notice
          error={
            new Error(
              callbackErrors[errorCode] ||
                'Provider sign-in failed. Please start again.',
            )
          }
        />
      )}
      {params.get('oauth') === 'connected' && (
        <Notice>Your provider account is connected. You’re signed in.</Notice>
      )}
      {redirecting && <p role="status">Opening your sign-in provider…</p>}
    </div>
  );
}
