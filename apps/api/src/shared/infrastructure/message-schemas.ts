import { z } from 'zod';

export const messageSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  schemaVersion: z.literal(1),
  aggregateId: z.string(),
  aggregateVersion: z.number().int().positive(),
  occurredAt: z.string().datetime(),
  correlationId: z.string(),
  payload: z.record(z.unknown()),
});

export const orderIdSchema = z.object({ orderId: z.string().uuid() });
