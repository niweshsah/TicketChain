import { oauthProviderSchema, oauthStartSchema } from '@ticketchain/shared';
import { Router } from 'express';
import { authenticate } from '../../../shared/authentication';
import { config } from '../../../shared/config';
import { AppError } from '../../../shared/errors';
import {
  asyncRoute,
  requireApplicationOrigin,
} from '../../../shared/http/context';
import { enforceRateLimit } from '../../../shared/http/rate-limit';
import { completeOAuth } from '../oauth/callback';
import { availableOAuthProviders } from '../oauth/providers';
import { beginOAuth } from '../oauth/start';
import { oauthCookieOptions, cookieOptions } from './session-cookies';

export const router = Router();
router.get('/auth/providers', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(availableOAuthProviders());
});

router.post(
  '/auth/oauth/:provider/start',
  asyncRoute(async (req, res) => {
    requireApplicationOrigin(req);
    await enforceRateLimit(`oauth:${req.ip}`, 20);
    const provider = oauthProviderSchema.parse(req.params.provider);
    const input = oauthStartSchema.parse(req.body);
    const linkingUser =
      input.intent === 'link'
        ? await authenticate(req.get('authorization'))
        : undefined;
    const attempt = await beginOAuth(provider, input, linkingUser);
    res.setHeader('Cache-Control', 'no-store');
    res.cookie(`tc_oauth_${provider}`, attempt.browserToken, {
      ...oauthCookieOptions,
      path: `/api/v1/auth/oauth/${provider}`,
    });
    res.json({ authorizationUrl: attempt.authorizationUrl });
  }),
);

router.get(
  '/auth/oauth/:provider/callback',
  asyncRoute(async (req, res) => {
    const provider = oauthProviderSchema.parse(req.params.provider);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.clearCookie(`tc_oauth_${provider}`, {
      ...oauthCookieOptions,
      maxAge: undefined,
      path: `/api/v1/auth/oauth/${provider}`,
    });
    try {
      const result = await completeOAuth(
        provider,
        req.query,
        (req.cookies as Record<string, string>)[`tc_oauth_${provider}`],
      );
      res.cookie('tc_refresh', result.refreshToken, cookieOptions);
      res.redirect(
        303,
        `${config.WEB_ORIGIN}/${result.user.role === 'organizer' ? 'organizer' : 'account'}?oauth=connected`,
      );
    } catch (error) {
      const code = error instanceof AppError ? error.code : 'OAUTH_FAILED';
      res.redirect(
        303,
        `${config.WEB_ORIGIN}/login?oauthError=${encodeURIComponent(code)}`,
      );
    }
  }),
);
