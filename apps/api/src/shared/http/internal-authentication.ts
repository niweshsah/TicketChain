import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { config } from '../config';
import { AppError } from '../errors';

export const internalAuthentication = Router();
internalAuthentication.use((req, _res, next) => {
  const supplied = Buffer.from(req.get('X-Service-Token') || '');
  const expected = Buffer.from(config.SERVICE_TOKEN);
  next(
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
      ? undefined
      : new AppError(403, 'FORBIDDEN', 'Internal service credentials required'),
  );
});
