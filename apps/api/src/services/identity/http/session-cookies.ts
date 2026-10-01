import { type Response } from 'express';
import { secureCookie } from '../../../shared/config';
import { login } from '../auth';

export const cookieOptions = {
  httpOnly: true,
  secure: secureCookie,
  sameSite: 'strict' as const,
  path: '/api/v1/auth',
  maxAge: 30 * 86400000,
};

export function sessionResponse(
  res: Response,
  session: Awaited<ReturnType<typeof login>>,
) {
  res.setHeader('Cache-Control', 'no-store');
  res.cookie('tc_refresh', session.refreshToken, cookieOptions);
  res.json({ accessToken: session.accessToken, user: session.user });
}

export const oauthCookieOptions = {
  httpOnly: true,
  secure: secureCookie,
  sameSite: 'lax' as const,
  maxAge: 10 * 60 * 1000,
};
