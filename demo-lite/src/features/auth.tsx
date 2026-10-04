import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { ticketApi as api, session, type AppDispatch } from '../store';
import { Notice } from './feedback';
import { SocialAuth } from './social-auth';
export function Auth({ register = false }: { register?: boolean }) {
  const [submit, { isLoading, error }] = api.useAuthMutation();
  const [message, setMessage] = useState('');
  const [role, setRole] = useState<'attendee' | 'organizer'>('attendee');
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  async function handle(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    try {
      const result = await submit({
        mode: register ? 'register' : 'login',
        body: {
          email: f.get('email'),
          password: f.get('password'),
          ...(register ? { name: f.get('name'), role: f.get('role') } : {}),
        },
      }).unwrap();
      if (!result.accessToken) {
        setMessage('Check your email to confirm your account, then sign in.');
        return;
      }
      dispatch(api.util.resetApiState());
      dispatch(session(result));
      const target = search.get('returnTo');
      navigate(
        target?.startsWith('/') && !target.startsWith('//')
          ? target
          : result.user.role === 'organizer'
            ? '/organizer'
            : '/profile',
      );
    } catch {
      /* Form values remain available. */
    }
  }
  return (
    <section className="auth panel">
      <span className="eyebrow">WELCOME TO YOUR NEXT CHAPTER</span>
      <h1>{register ? 'Join the crowd.' : 'Welcome back.'}</h1>
      <form onSubmit={(ev) => void handle(ev)}>
        {register && (
          <label>
            Your name
            <input name="name" required minLength={2} autoComplete="name" />
          </label>
        )}
        <label>
          Email
          <input name="email" type="email" required autoComplete="email" />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            required
            minLength={register ? 10 : 1}
            autoComplete={register ? 'new-password' : 'current-password'}
          />
        </label>
        {register && (
          <label>
            I want to
            <select
              name="role"
              value={role}
              onChange={(event) => setRole(event.target.value as typeof role)}
            >
              <option value="attendee">Attend events</option>
              <option value="organizer">Organize events</option>
            </select>
          </label>
        )}
        <Notice error={error}>{message}</Notice>
        <button className="button" disabled={isLoading}>
          {isLoading ? 'Please wait…' : register ? 'Create account' : 'Sign in'}
        </button>
      </form>
      <SocialAuth role={role} />
      <p>
        {register ? 'Already part of the crowd?' : 'New here?'}{' '}
        <Link to={register ? '/login' : '/register'}>
          {register ? 'Sign in' : 'Create an account'}
        </Link>
      </p>
    </section>
  );
}
