import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { ticketApi as api, type RootState } from '../store';
export function errorMessage(error: unknown): string {
  if (
    error &&
    typeof error === 'object' &&
    'issues' in error &&
    Array.isArray(error.issues)
  ) {
    return error.issues
      .map(
        (issue: { path: (string | number)[]; message: string }) =>
          `${issue.path.join('.') || 'Event'}: ${issue.message}`,
      )
      .join(' · ');
  }
  if (error && typeof error === 'object' && 'data' in error) {
    const data = error.data as {
      message?: string;
      fields?: Record<string, string[]>;
    };
    return (
      [
        data.message,
        ...Object.entries(data.fields || {}).map(
          ([field, errors]) => `${field}: ${errors.join(', ')}`,
        ),
      ]
        .filter(Boolean)
        .join(' · ') || 'Request failed'
    );
  }
  return error instanceof Error
    ? error.message
    : 'Request failed. Please try again.';
}
export function Notice({
  error,
  children,
}: {
  error?: unknown;
  children?: ReactNode;
}) {
  return error || children ? (
    <p
      className={error ? 'notice error' : 'notice'}
      role={error ? 'alert' : 'status'}
    >
      {error ? errorMessage(error) : children}
    </p>
  ) : null;
}
export const date = (value: string, timezone?: string) =>
  new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone,
  }).format(new Date(value));
export function Gate({
  children,
  organizer = false,
}: {
  children: ReactNode;
  organizer?: boolean;
}) {
  const location = useLocation();
  const [enable, mutation] = api.useBecomeOrganizerMutation();
  const { user } = useSelector((s: RootState) => s.auth);
  const { isLoading } = api.useMeQuery();
  if (isLoading) return <p role="status">Restoring your session…</p>;
  if (!user)
    return (
      <div className="panel">
        <h1>Your next experience awaits.</h1>
        <p>Sign in to continue.</p>
        <Link
          className="button"
          to={`/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`}
        >
          Sign in
        </Link>
      </div>
    );
  if (organizer && user.role !== 'organizer')
    return (
      <section className="section narrow panel">
        <span className="eyebrow">ORGANIZE WITH TICKETCHAIN</span>
        <h1>Bring your crowd together.</h1>
        <p>
          Enable organizer tools on your account to create events and check in
          guests. Your tickets stay with you.
        </p>
        <Notice error={mutation.error} />
        <button
          className="button"
          disabled={mutation.isLoading}
          onClick={() =>
            void enable()
              .unwrap()
              .catch(() => undefined)
          }
        >
          {mutation.isLoading ? 'Enabling…' : 'Become an organizer'}
        </button>
      </section>
    );
  return children;
}
