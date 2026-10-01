import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { router as bookingRoutes } from './services/booking/http';
import { router as standaloneDiscovery } from './services/booking/http/discovery-routes';
import { router as catalogRoutes } from './services/catalog/http';
import { router as identityRoutes } from './services/identity/http';
import { router as avatarRoutes } from './services/identity/http/avatar-routes';
import { router as paymentRoutes } from './services/payments/http';
import { router as webhookRoutes } from './services/payments/http/webhook-routes';
import { config } from './shared/config';
import { AppError } from './shared/errors';
import { errorHandler } from './shared/http/error-handler';
import { router as health } from './shared/http/health';
import { internalRouter } from './shared/http/internal-routes';
import { metricsRouter } from './shared/http/metrics';
import { requestLogging } from './shared/http/request-logging';
import { serviceBoundary } from './shared/http/service-boundary';

export { httpFailures } from './shared/http/metrics';
export const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.TRUST_PROXY_HOPS);
app.use(
  requestLogging,
  serviceBoundary,
  helmet(),
  cors({ origin: config.WEB_ORIGIN, credentials: true }),
);
// Signature verification and avatar decoding require untouched request bytes.
if (['standalone', 'payments'].includes(config.SERVICE_NAME))
  app.use(webhookRoutes);
if (['standalone', 'identity'].includes(config.SERVICE_NAME))
  app.use(avatarRoutes);
app.use(express.json({ limit: '64kb' }), cookieParser());
app.set('json replacer', (_key: string, value: unknown) =>
  typeof value === 'bigint' ? value.toString() : value,
);
app.use('/internal', internalRouter);
app.use(health, metricsRouter);
if (config.SERVICE_NAME === 'standalone')
  app.use('/api/v1', standaloneDiscovery);
const serviceRoutes = {
  identity: identityRoutes,
  booking: bookingRoutes,
  payments: paymentRoutes,
  catalog: catalogRoutes,
};
for (const [service, router] of Object.entries(serviceRoutes)) {
  if (config.SERVICE_NAME === 'standalone' || config.SERVICE_NAME === service)
    app.use('/api/v1', router);
}
app.use((_req, _res, next) =>
  next(new AppError(404, 'NOT_FOUND', 'Route not found')),
);
app.use(errorHandler);
