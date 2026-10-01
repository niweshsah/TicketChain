import { Router } from 'express';
import { config } from '../config';
import { AppError } from '../errors';

export const serviceBoundary = Router();
serviceBoundary.use((req, _res, next) => {
  if (config.SERVICE_NAME === 'standalone' || !req.path.startsWith('/api/'))
    return next();
  const path = req.path;
  const expected =
    path.startsWith('/api/v1/auth') || path.startsWith('/api/v1/me')
      ? 'identity'
      : path.startsWith('/api/v1/payments') ||
          path.startsWith('/api/v1/webhooks')
        ? 'payments'
        : path === '/api/v1/events'
          ? 'catalog'
          : 'booking';
  next(
    config.SERVICE_NAME === expected
      ? undefined
      : new AppError(404, 'NOT_FOUND', 'Route belongs to another service'),
  );
});
