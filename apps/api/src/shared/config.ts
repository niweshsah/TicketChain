import 'dotenv/config';
import { z } from 'zod';

export const optionalSecret = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(1).optional(),
);

export const schema = z.object({
  SERVICE_NAME: z
    .enum(['standalone', 'identity', 'booking', 'payments', 'catalog'])
    .default('standalone'),
  SERVICE_TOKEN: z
    .string()
    .min(32)
    .default('local-internal-service-token-replace-in-production'),
  IDENTITY_URL: z.string().url().default('http://identity:5000'),
  BOOKING_URL: z.string().url().default('http://booking:5000'),
  PAYMENTS_URL: z.string().url().default('http://payments:5000'),
  RABBITMQ_URL: z.string().url().optional(),
  REDIS_URL: z.string().url().optional(),
  ELASTICSEARCH_URL: z.string().url().optional(),
  AVATAR_S3_ENDPOINT: z.string().url().default('http://localhost:9000'),
  AVATAR_S3_BUCKET: z.string().default('avatars'),
  AVATAR_S3_ACCESS_KEY: z.string().default('localavatars'),
  AVATAR_S3_SECRET_KEY: z
    .string()
    .default('local-avatar-storage-replace-in-production'),
  JWT_PRIVATE_KEY_PATH: z.string().optional(),
  JWT_PUBLIC_KEY_PATH: z.string().optional(),
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  PORT: z.coerce.number().int().default(5000),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(1).default(0),
  PAYMENT_PROVIDER: z.enum(['demo', 'razorpay']).default('demo'),
  ALLOW_DEMO_PAYMENTS: z.enum(['true', 'false']).default('false'),
  DEMO_ACCOUNT_PASSWORD: z.string().min(12).optional(),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  APTOS_TREASURY: z.string().optional(),
  APTOS_PRIVATE_KEY: z.string().optional(),
  APTOS_MODULE: z.string().optional(),
  GOOGLE_CLIENT_ID: optionalSecret,
  GOOGLE_CLIENT_SECRET: optionalSecret,
  GITHUB_CLIENT_ID: optionalSecret,
  GITHUB_CLIENT_SECRET: optionalSecret,
  DEMO_DATABASE_NAME: z.string().default('ticketchain_demo'),
});

export const config = schema.parse(process.env);

export const demoPaymentsAllowed =
  config.NODE_ENV !== 'production' || config.ALLOW_DEMO_PAYMENTS === 'true';

export const secureCookie =
  !config.WEB_ORIGIN.startsWith('http://localhost:') &&
  config.NODE_ENV !== 'test';
