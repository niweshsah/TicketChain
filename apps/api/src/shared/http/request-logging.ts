import { Router } from 'express';
import { randomUUID } from 'node:crypto';

export const requestLogging = Router();
requestLogging.use((req, res, next) => {
  res.locals.requestId = randomUUID();
  res.setHeader('X-Request-ID', res.locals.requestId);
  const started = Date.now();
  res.on('finish', () => {
    console.log(
      JSON.stringify({
        requestId: res.locals.requestId,
        method: req.method,
        status: res.statusCode,
        durationMs: Date.now() - started,
      }),
    );
  });
  next();
});
