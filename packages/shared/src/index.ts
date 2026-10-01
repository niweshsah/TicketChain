import { z } from 'zod';
export * from './location';
import { citySchema, categories, languages, agePolicies } from './location';
// Preserve the contract error constructor across CommonJS and ESM consumers.
export { ZodError as ContractValidationError } from 'zod';
export const id = z.string().uuid();
export const registerSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    email: z
      .string()
      .email()
      .transform((v) => v.toLowerCase()),
    password: z.string().min(10).max(128),
    role: z.enum(['attendee', 'organizer']).default('attendee'),
  })
  .strict();
export const oauthProviderSchema = z.enum(['google', 'github']);
export const oauthStartSchema = z
  .object({
    role: z.enum(['attendee', 'organizer']).default('attendee'),
    intent: z.enum(['login', 'link']).default('login'),
  })
  .strict();
export const oauthProvidersSchema = z.object({
  google: z.boolean(),
  github: z.boolean(),
});
export type OAuthProvider = z.infer<typeof oauthProviderSchema>;
export type OAuthStart = z.infer<typeof oauthStartSchema>;
export const loginSchema = registerSchema.pick({ email: true, password: true });
export const tierSchema = z
  .object({
    id: id.optional(),
    name: z.string().trim().min(1).max(80),
    pricePaise: z.number().int().min(100).max(100000000),
    priceOctas: z
      .string()
      .regex(/^[1-9]\d{0,18}$/)
      .refine(
        (v) => BigInt(v) <= 9223372036854775807n,
        'Octas exceed PostgreSQL bigint range',
      )
      .optional(),
    quantity: z.number().int().min(1).max(10000),
    inclusions: z.array(z.string().trim().min(1).max(200)).max(10).optional(),
  })
  .strict();
export const eventSchema = z
  .object({
    performers: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
    venueAddress: z.string().trim().max(500).optional(),
    entryAt: z.string().datetime().nullable().optional(),
    languages: z.array(z.enum(languages)).max(15).optional(),
    agePolicy: z.enum(agePolicies).nullable().optional(),
    accessibilityNotes: z.string().trim().max(2000).optional(),
    testMarker: z
      .string()
      .regex(/^browser:[a-zA-Z0-9-]+$/)
      .max(100)
      .optional(),
    waitingRoom: z.boolean().optional(),
    title: z.string().trim().min(3).max(160),
    description: z.string().max(10000),
    category: z.enum(categories),
    venue: z.string().min(2).max(200),
    city: citySchema,
    timezone: z.string().refine((v) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: v });
        return true;
      } catch {
        return false;
      }
    }, 'Use an IANA timezone'),
    imageUrl: z
      .string()
      .url()
      .refine((v) => v.startsWith('https://'), 'Use an HTTPS image'),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    tiers: z.array(tierSchema).min(1).max(10),
  })
  .strict()
  .refine((v) => new Date(v.endsAt) > new Date(v.startsAt), {
    path: ['endsAt'],
    message: 'End must follow start',
  })
  .refine(
    (v) =>
      !v.entryAt ||
      (Date.parse(v.entryAt) <= Date.parse(v.startsAt) &&
        Date.parse(v.entryAt) >= Date.parse(v.startsAt) - 86400000),
    {
      path: ['entryAt'],
      message: 'Entry must be within 24 hours before start',
    },
  )
  .refine(
    (v) =>
      new Set(v.tiers.filter((t) => t.id).map((t) => t.id)).size ===
      v.tiers.filter((t) => t.id).length,
    { path: ['tiers'], message: 'Duplicate tier IDs' },
  );
export const orderSchema = z
  .object({
    eventId: id,
    admissionPass: z.string().max(150).optional(),
    currency: z.enum(['INR', 'APT']).default('INR'),
    items: z
      .array(
        z
          .object({ tierId: id, quantity: z.number().int().min(1).max(10) })
          .strict(),
      )
      .min(1)
      .max(10),
  })
  .strict()
  .refine(
    (v) => v.items.reduce((n, i) => n + i.quantity, 0) <= 10,
    'At most ten tickets',
  )
  .refine(
    (v) => new Set(v.items.map((i) => i.tierId)).size === v.items.length,
    'Duplicate tiers',
  );
export const discoverySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().max(100).default(''),
  category: z.string().max(80).default(''),
  city: z.union([citySchema, z.literal('')]).default(''),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  available: z.enum(['true', 'false']).optional(),
  sort: z.enum(['date', 'newest', 'title']).default('date'),
});
export const paymentSchema = z
  .object({
    orderId: id,
    scenario: z
      .enum(['success', 'failure', 'delayed', 'uncertain'])
      .default('success'),
    paymentId: z.string().max(100).optional(),
    signature: z.string().max(200).optional(),
    transactionHash: z
      .string()
      .regex(/^0x[0-9a-fA-F]{64}$/)
      .optional(),
  })
  .strict();
export const codeSchema = z
  .object({ code: z.string().min(16).max(100) })
  .strict();
export const publicUserSchema = z.object({
  id,
  name: z.string(),
  email: z.string().email(),
  role: z.enum(['attendee', 'organizer']),
  wallet: z.string().nullable(),
  avatarUrl: z.string().nullable().optional(),
  homeCity: citySchema.nullable().optional(),
  capabilities: z.array(z.enum(['attendee', 'organizer'])).optional(),
  linkedProviders: z.array(z.enum(['google', 'github'])).optional(),
});
export const errorSchema = z.object({
  code: z.string(),
  message: z.string(),
  requestId: z.string(),
  fields: z.record(z.array(z.string())).optional(),
});
export type PublicUser = z.infer<typeof publicUserSchema>;
export type EventInput = z.infer<typeof eventSchema>;
export type OrderInput = z.infer<typeof orderSchema>;
export type PaymentInput = z.infer<typeof paymentSchema>;
export const tierDtoSchema = z.object({
  status: z.enum(['active', 'retired']).optional(),
  inclusions: z.array(z.string()).nullable().optional(),
  id,
  name: z.string(),
  price_paise: z.number().int(),
  price_octas: z.string().nullable(),
  quantity: z.number().int(),
  available: z.number().int(),
});
export const eventDtoSchema = z.object({
  performers: z.array(z.string()).nullable().optional(),
  venue_address: z.string().nullable().optional(),
  entry_at: z.string().datetime().nullable().optional(),
  languages: z.array(z.string()).nullable().optional(),
  age_policy: z.string().nullable().optional(),
  accessibility_notes: z.string().nullable().optional(),
  retired_tiers: z.array(tierDtoSchema).optional(),
  waiting_room: z.boolean().optional(),
  id,
  owner_id: id,
  title: z.string(),
  description: z.string(),
  category: z.string(),
  venue: z.string(),
  city: z.string(),
  timezone: z.string(),
  image_url: z.string().url(),
  starts_at: z.string().datetime(),
  ends_at: z.string().datetime(),
  status: z.enum(['draft', 'published', 'cancelled', 'finished']),
  tiers: z.array(tierDtoSchema),
});
export const orderDtoSchema = z.object({
  financial_review: z.boolean().optional(),
  id,
  event_id: id,
  event_title: z.string(),
  status: z.string(),
  currency: z.enum(['INR', 'APT']),
  total: z.string(),
  expires_at: z.string().datetime(),
  items: z.array(
    z.object({
      tier_name: z.string(),
      price: z.string(),
      quantity: z.number().int(),
    }),
  ),
});
export const ticketDtoSchema = z.object({
  id,
  event_id: id,
  event_title: z.string(),
  tier_name: z.string(),
  status: z.string(),
  checked_at: z.string().datetime().nullable(),
  order_status: z.string(),
});
export type TierDto = z.infer<typeof tierDtoSchema>;
export type EventDto = z.infer<typeof eventDtoSchema>;
export type OrderDto = z.infer<typeof orderDtoSchema>;
export type TicketDto = z.infer<typeof ticketDtoSchema>;
export function canonicalOrder(input: OrderInput): string {
  return JSON.stringify({
    eventId: input.eventId,
    currency: input.currency,
    items: [...input.items].sort((a, b) => a.tierId.localeCompare(b.tierId)),
  });
}
export function money(value: string | number, currency = 'INR'): string {
  return currency === 'APT'
    ? `${(BigInt(value) / 100000000n).toString()}.${(BigInt(value) % 100000000n).toString().padStart(8, '0')} APT`
    : new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
      }).format(Number(value) / 100);
}

export const profileUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    homeCity: citySchema.nullable().optional(),
  })
  .strict();

export const waitingRoomStatusSchema = z.object({
  state: z.enum(['disabled', 'not_joined', 'waiting', 'admitted', 'left']),
  position: z.number().int().min(0),
  pass: z.string().optional(),
  expiresAt: z.number().optional(),
});
