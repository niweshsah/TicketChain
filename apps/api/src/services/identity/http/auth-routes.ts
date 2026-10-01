import { Router } from 'express';
import { assertRule } from '../../../shared/errors';
import {
  asyncRoute,
  requireApplicationOrigin,
} from '../../../shared/http/context';
import { enforceRateLimit } from '../../../shared/http/rate-limit';
import { register, login, refresh, logout } from '../auth';
import { sessionResponse, cookieOptions } from './session-cookies';

export const router = Router();
router.post(
  '/auth/register',
  asyncRoute(async (req, res) => {
    requireApplicationOrigin(req);
    await enforceRateLimit(`auth:${req.ip}`, 20);
    sessionResponse(res, await register(req.body));
  }),
);

router.post(
  '/auth/login',
  asyncRoute(async (req, res) => {
    requireApplicationOrigin(req);
    await enforceRateLimit(`auth:${req.ip}`, 20);
    sessionResponse(res, await login(req.body));
  }),
);

router.post(
  '/auth/refresh',
  asyncRoute(async (req, res) => {
    requireApplicationOrigin(req);
    await enforceRateLimit(`refresh:${req.ip}`, 60);
    const token = (req.cookies as Record<string, string>).tc_refresh;
    assertRule(token, 'UNAUTHORIZED', 'Please sign in', 401);
    sessionResponse(res, await refresh(token));
  }),
);

router.post(
  '/auth/logout',
  asyncRoute(async (req, res) => {
    requireApplicationOrigin(req);
    await logout((req.cookies as Record<string, string>).tc_refresh || '');
    res.clearCookie('tc_refresh', { ...cookieOptions, maxAge: undefined });
    res.status(204).end();
  }),
);
