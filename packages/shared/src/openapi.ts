import { writeFileSync } from 'node:fs';
import { z } from 'zod';
import {
  extendZodWithOpenApi,
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from '@asteasolutions/zod-to-openapi';
import {
  eventDtoSchema as event,
  orderDtoSchema as order,
  registerSchema,
  oauthStartSchema,
  oauthProvidersSchema,
  oauthProviderSchema,
  loginSchema,
  eventSchema,
  orderSchema,
  paymentSchema,
  discoverySchema,
  publicUserSchema,
  profileUpdateSchema,
  waitingRoomStatusSchema,
  errorSchema,
  codeSchema,
  id,
} from './index';
extendZodWithOpenApi(z);
const registry = new OpenAPIRegistry();
registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
});
const json = (schema: z.ZodTypeAny) => ({ 'application/json': { schema } });
const response = (schema: z.ZodTypeAny) => ({
  200: { description: 'Success', content: json(schema) },
  201: {
    description: 'Created (order or event creation)',
    content: json(schema),
  },
  204: { description: 'No content (logout)' },
  400: { description: 'Validation error', content: json(errorSchema) },
  401: { description: 'Authentication required', content: json(errorSchema) },
  403: { description: 'Not authorized', content: json(errorSchema) },
  409: { description: 'State conflict', content: json(errorSchema) },
});
const session = z.object({ accessToken: z.string(), user: publicUserSchema });
function route(
  method: 'get' | 'post' | 'put' | 'patch',
  path: string,
  summary: string,
  input: z.ZodTypeAny | undefined,
  output: z.ZodTypeAny,
  auth = true,
) {
  registry.registerPath({
    method,
    path: `/api/v1${path}`,
    summary,
    security: auth ? [{ bearerAuth: [] }] : [],
    request: {
      ...(input ? { body: { content: json(input) } } : {}),
      ...(path.includes('{id}') ? { params: z.object({ id }) } : {}),
      ...(method === 'post' && path === '/orders'
        ? {
            headers: z.object({
              'Idempotency-Key': z.string().min(8).max(128),
            }),
          }
        : {}),
    },
    responses: response(output),
  });
}
route(
  'patch',
  '/me',
  'Edit display name',
  profileUpdateSchema,
  publicUserSchema,
);
route(
  'post',
  '/me/organizer',
  'Enable organizer capability without replacing the account',
  undefined,
  publicUserSchema,
);
route(
  'get',
  '/events/{id}/waiting-room',
  'Waiting-room position and admission pass',
  undefined,
  waitingRoomStatusSchema,
);
route(
  'post',
  '/events/{id}/waiting-room',
  'Join or leave the waiting room',
  z.object({ operation: z.enum(['join', 'leave']) }),
  waitingRoomStatusSchema,
);
route(
  'get',
  '/auth/providers',
  'Configured Google and GitHub sign-in options',
  undefined,
  oauthProvidersSchema,
  false,
);
registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/oauth/{provider}/start',
  summary:
    'Start browser-bound PKCE social login or authenticated account linking; exact Origin required',
  request: {
    params: z.object({ provider: oauthProviderSchema }),
    body: { content: json(oauthStartSchema) },
  },
  responses: response(z.object({ authorizationUrl: z.string().url() })),
});
registry.registerPath({
  method: 'get',
  path: '/api/v1/auth/oauth/{provider}/callback',
  summary:
    'Consume single-use callback state, verify provider identity, set refresh cookie and redirect without tokens in URL',
  request: {
    params: z.object({ provider: oauthProviderSchema }),
    query: z.object({
      state: z.string(),
      code: z.string().optional(),
      error: z.string().optional(),
    }),
  },
  responses: {
    303: { description: 'Redirect to account/dashboard or safe login error' },
  },
});
route(
  'post',
  '/auth/register',
  'Create attendee or organizer account',
  registerSchema,
  session,
  false,
);
route(
  'post',
  '/auth/login',
  'Sign in and set HttpOnly rotating refresh cookie',
  loginSchema,
  session,
  false,
);
route(
  'post',
  '/auth/refresh',
  'Rotate refresh cookie; exact Origin required',
  undefined,
  session,
  false,
);
route(
  'post',
  '/auth/logout',
  'Revoke refresh token family',
  undefined,
  z.object({}),
  false,
);
route(
  'get',
  '/me',
  'Authenticated public profile',
  undefined,
  publicUserSchema,
);
registry.registerPath({
  method: 'get',
  path: '/api/v1/events',
  summary: 'Future published event discovery',
  request: { query: discoverySchema },
  responses: response(
    z.object({ events: z.array(event), page: z.number(), limit: z.number() }),
  ),
});
route(
  'get',
  '/events/{id}',
  'Published event details',
  undefined,
  event,
  false,
);
route(
  'get',
  '/organizer/events',
  'Owned events including drafts',
  undefined,
  z.array(event),
);
route('post', '/organizer/events', 'Create draft', eventSchema, event);
route(
  'put',
  '/organizer/events/{id}',
  'Edit draft or published event',
  eventSchema,
  event,
);
for (const action of ['preview', 'summary', 'attendees'])
  route(
    'get',
    `/organizer/events/{id}/${action}`,
    `Organizer ${action}`,
    undefined,
    action === 'preview' ? event : z.array(z.record(z.unknown())),
  );
for (const action of ['publish', 'cancel', 'finish'])
  route(
    'post',
    `/organizer/events/{id}/${action}`,
    `Organizer ${action}`,
    undefined,
    event,
  );
route(
  'post',
  '/organizer/events/{id}/check-in',
  'Single-use admission',
  codeSchema,
  z.object({ id, checked_at: z.string().datetime() }),
);
route(
  'post',
  '/orders',
  'Atomic hold; required Idempotency-Key header',
  orderSchema,
  order,
);
route('get', '/orders', 'Owned order history', undefined, z.array(order));
route('get', '/orders/{id}', 'Owned order status', undefined, order);
route(
  'post',
  '/orders/{id}/refund',
  'Whole-order refund before event start',
  undefined,
  order,
);
route(
  'post',
  '/payments/initialize',
  'Persist provider operation; worker creates order',
  z.object({ orderId: id }),
  z.object({
    operationId: id,
    provider: z.string(),
    status: z.string(),
    providerOrderId: z.string().nullable(),
    amount: z.string(),
    currency: z.string(),
  }),
);
route(
  'post',
  '/payments/confirm',
  'Verify provider evidence before fulfillment',
  paymentSchema,
  z.object({ status: z.string() }),
);
route(
  'get',
  '/tickets',
  'Owned tickets without QR secrets',
  undefined,
  z.array(
    z.object({
      id,
      event_id: id,
      event_title: z.string(),
      tier_name: z.string(),
      status: z.string(),
      checked_at: z.string().datetime().nullable(),
      order_status: z.string(),
    }),
  ),
);
route(
  'get',
  '/tickets/{id}/qr',
  'Private opaque admission credential',
  undefined,
  z.object({ code: z.string() }),
);
route(
  'post',
  '/tickets/{id}/claim',
  'One collectible claim per paid ticket; wallet snapshot',
  undefined,
  z.object({ id }),
);
route(
  'post',
  '/me/wallet/challenges',
  'Expiring testnet wallet challenge',
  z.object({ wallet: z.string() }),
  z.object({ id, message: z.string(), nonce: z.string() }),
);
route(
  'post',
  '/me/wallet',
  'Verify standard Ed25519 signature',
  z.object({
    challengeId: id,
    publicKey: z.string(),
    signature: z.string(),
    fullMessage: z.string(),
  }),
  z.object({ wallet: z.string() }),
);
route(
  'post',
  '/webhooks/razorpay',
  'Signed raw-body ingestion; acknowledge after durable persistence',
  z.record(z.unknown()),
  z.object({ accepted: z.boolean() }),
  false,
);
registry.registerPath({
  method: 'post',
  path: '/api/v1/me/avatar',
  summary:
    'Replace profile photo; JPEG, PNG or WebP up to 5 MB and 20 megapixels',
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      required: true,
      content: {
        'image/jpeg': {
          schema: z.string().openapi({ type: 'string', format: 'binary' }),
        },
        'image/png': {
          schema: z.string().openapi({ type: 'string', format: 'binary' }),
        },
        'image/webp': {
          schema: z.string().openapi({ type: 'string', format: 'binary' }),
        },
      },
    },
  },
  responses: response(publicUserSchema),
});
registry.registerPath({
  method: 'delete',
  path: '/api/v1/me/avatar',
  summary: 'Remove profile photo',
  security: [{ bearerAuth: [] }],
  responses: response(publicUserSchema),
});
writeFileSync(
  'docs/openapi.json',
  JSON.stringify(
    new OpenApiGeneratorV3(registry.definitions).generateDocument({
      openapi: '3.0.3',
      info: { title: 'TicketChain API', version: '1.0.0' },
      servers: [{ url: 'http://localhost:5000' }],
    }),
    null,
    2,
  ) + '\n',
);
