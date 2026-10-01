import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { config } from '../../shared/config';
import { db, one, transaction } from '../../shared/db';
import { requireValue } from '../../shared/errors';
import { enqueue } from '../../shared/infrastructure/jobs';
import { orderIdSchema } from '../../shared/infrastructure/message-schemas';
import {
  publishIntent,
  type DomainMessage,
} from '../../shared/infrastructure/messages';
import { type Operation } from '../../shared/types';
import { treasurySubmit } from './aptos/treasury';
import { synchronizeOrder } from './order-snapshot';

export async function requestProviderRefund(message: DomainMessage) {
  const { orderId } = orderIdSchema.parse(message.payload);
  await synchronizeOrder(orderId);
  const payment = requireValue(
    await one<Operation>(
      db,
      "SELECT * FROM tc_provideroperation WHERE order_id=$1::uuid AND kind='payment'",
      orderId,
    ),
  );
  const extra =
    message.type === 'refund.extra'
      ? z.string().min(1).parse(message.payload.paymentId)
      : undefined;
  await transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      'INSERT INTO tc_provideroperation(id,order_id,kind,provider,data) VALUES($1::uuid,$2::uuid,$3,$4,$5::jsonb) ON CONFLICT(order_id,kind) DO NOTHING',
      randomUUID(),
      orderId,
      extra ? `extra:${extra}` : 'refund',
      payment.provider,
      JSON.stringify(message.payload),
    );
    await enqueue(
      tx,
      extra ? 'extra-refund' : 'refund',
      extra ? `extra:${extra}` : `refund:${orderId}`,
      { orderId, ...(extra ? { paymentId: extra } : {}) },
    );
  });
}

export async function mintCollectible(message: DomainMessage) {
  const input = z
    .object({
      claimId: z.string().uuid(),
      ticketId: z.string().uuid(),
      recipient: z.string(),
      orderId: z.string().uuid(),
    })
    .parse(message.payload);
  await synchronizeOrder(input.orderId);
  await db.$executeRawUnsafe(
    "INSERT INTO tc_provideroperation(id,order_id,kind,provider) VALUES($1::uuid,$2::uuid,$3,'aptos') ON CONFLICT(order_id,kind) DO NOTHING",
    input.claimId,
    input.orderId,
    `claim:${input.claimId}`,
  );
  await treasurySubmit(input.claimId, {
    function: `${requireValue(config.APTOS_MODULE)}::collectibles::mint`,
    functionArguments: [
      input.ticketId,
      input.recipient,
      `Ticket ${input.ticketId}`,
      'https://ticketchain.local/collectible',
    ],
  });
  const operation = requireValue(
    await one<Operation>(
      db,
      'SELECT * FROM tc_provideroperation WHERE id=$1::uuid',
      input.claimId,
    ),
  );
  await transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      "UPDATE tc_provideroperation SET status='confirmed' WHERE id=$1::uuid",
      input.claimId,
    );
    await publishIntent(
      tx,
      'claim.confirmed',
      input.orderId,
      {
        claimId: input.claimId,
        hash: operation.external_id,
        ...operation.data,
      },
      'booking',
      `claim-confirmed:${input.claimId}`,
    );
  });
}

export const messageHandlers = {
  'refund.requested': requestProviderRefund,
  'refund.extra': requestProviderRefund,
  'claim.requested': mintCollectible,
};
