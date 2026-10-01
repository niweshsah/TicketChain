import { describe, it, expect } from 'vitest';
import {
  orderSchema,
  registerSchema,
  canonicalOrder,
  money,
  discoverySchema,
} from '../../packages/shared/src';
const eventId = '00000000-0000-4000-8000-000000000001';
const tierId = '00000000-0000-4000-8000-000000000002';
describe('contracts', () => {
  it('rejects privilege escalation', () => {
    expect(
      registerSchema.safeParse({
        name: 'Test',
        email: 'test@example.com',
        password: 'a secure password',
        role: 'admin',
      }).success,
    ).toBe(false);
  });
  it('bounds quantities and rejects duplicate tiers', () => {
    expect(
      orderSchema.safeParse({ eventId, items: [{ tierId, quantity: 11 }] })
        .success,
    ).toBe(false);
    expect(
      orderSchema.safeParse({
        eventId,
        items: [
          { tierId, quantity: 1 },
          { tierId, quantity: 1 },
        ],
      }).success,
    ).toBe(false);
  });
  it('canonicalizes mixed-tier retries', () => {
    const a = {
      eventId,
      currency: 'INR' as const,
      items: [
        { tierId, quantity: 1 },
        { tierId: eventId, quantity: 2 },
      ],
    };
    expect(canonicalOrder(a)).toEqual(
      canonicalOrder({ ...a, items: [...a.items].reverse() }),
    );
  });
  it('encodes octas without losing integer precision', () => {
    expect(money('9007199254740993', 'APT')).toBe('90071992.54740993 APT');
  });
  it('bounds discovery pagination', () => {
    expect(discoverySchema.parse({}).limit).toBe(20);
    expect(discoverySchema.safeParse({ limit: 101 }).success).toBe(false);
  });
});
