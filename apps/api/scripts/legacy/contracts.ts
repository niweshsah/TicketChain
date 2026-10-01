import { dirname } from 'node:path';
import { writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import { z } from 'zod';

export const tableNames = [
  'User',
  'Organizer',
  'Venue',
  'Event',
  'TicketType',
  'Ticket',
  'Reservation',
  'Order',
  'OrderItem',
  'Payment',
  'BlockchainTransaction',
  'TicketTransfer',
  'OrganizerRoyalty',
  'EventReview',
] as const;
const record = z.object({ id: z.string().uuid() }).passthrough();
export const dumpSchema = z.object({
  version: z.literal(1),
  source: z.string(),
  exportedAt: z.string(),
  tables: z.record(z.array(record)),
});
export const mappingSchema = z.object({
  currencyByTier: z.record(z.enum(['INR', 'APT'])),
  minorUnitByTier: z.record(z.enum(['paise', 'octas'])),
  timezoneByEvent: z.record(z.string()),
  paymentEvidenceByOrder: z.record(
    z.object({
      provider: z.enum(['razorpay', 'aptos', 'legacy-verified']),
      paymentId: z.string().min(1),
      currency: z.enum(['INR', 'APT']),
      amount: z.string().regex(/^[1-9]\d*$/),
      verifiedAt: z.string().datetime(),
      reference: z.string().min(10),
      sender: z.string().optional(),
    }),
  ),
});
export type RecordRow = z.infer<typeof record>;
export const str = (r: RecordRow, key: string) =>
  typeof r[key] === 'string' ? String(r[key]) : '';
export const num = (r: RecordRow, key: string) =>
  typeof r[key] === 'number' ? Number(r[key]) : 0;
export function save(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  chmodSync(path, 0o600);
}

export type LegacyDump = z.infer<typeof dumpSchema>;
export type LegacyMapping = z.infer<typeof mappingSchema>;
