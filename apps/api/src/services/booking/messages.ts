import { z } from 'zod';
import { db } from '../../shared/db';
import { orderIdSchema } from '../../shared/infrastructure/message-schemas';
import { type DomainMessage } from '../../shared/infrastructure/messages';
import { fulfill } from './orders/fulfillment';
import { finishRefund } from './orders/refunds';

export async function acceptCapture(message: DomainMessage) {
  const input = z
    .object({
      orderId: z.string().uuid(),
      paymentId: z.string().min(1).max(200),
      amount: z.string().regex(/^\d+$/),
      currency: z.enum(['INR', 'APT']),
      operationId: z.string().uuid(),
      provider: z.enum(['demo', 'razorpay', 'aptos']),
      externalId: z.string().nullable(),
      sender: z.string().optional(),
    })
    .parse(message.payload);
  await db.$executeRawUnsafe(
    "INSERT INTO tc_provideroperation(id,order_id,kind,provider,status,external_id) VALUES($1::uuid,$2::uuid,'payment',$3,'ready',$4) ON CONFLICT(order_id,kind) DO NOTHING",
    input.operationId,
    input.orderId,
    input.provider,
    input.externalId,
  );
  await fulfill(
    input.orderId,
    input.paymentId,
    BigInt(input.amount),
    input.currency,
    input.sender,
  );
}

export async function acceptPaymentReview(message: DomainMessage) {
  const input = z
    .object({
      orderId: z.string().uuid(),
      operationId: z.string().uuid(),
      provider: z.string(),
      externalId: z.string().nullable(),
      reason: z.string(),
    })
    .parse(message.payload);
  await db.$executeRawUnsafe(
    `
      INSERT INTO tc_provideroperation(id,order_id,kind,provider,status,external_id,data) VALUES($1::uuid,$2::uuid,'payment',$3,'uncertain',$4,$5::jsonb) ON CONFLICT(order_id,kind)
      DO UPDATE SET status='uncertain',data=tc_provideroperation.data || EXCLUDED.data
      WHERE tc_provideroperation.status<>'captured'
    `,
    input.operationId,
    input.orderId,
    input.provider,
    input.externalId,
    JSON.stringify({ reviewReason: input.reason }),
  );
}

export async function acceptRefund(message: DomainMessage) {
  await finishRefund(orderIdSchema.parse(message.payload).orderId);
}

export async function acceptClaim(message: DomainMessage) {
  const input = z
    .object({
      claimId: z.string().uuid(),
      hash: z.string(),
      signedBytes: z.string(),
      sequence: z.string(),
      expiration: z.string(),
    })
    .parse(message.payload);
  await db.$executeRawUnsafe(
    "UPDATE tc_claim SET status='confirmed',tx_hash=$2,signed_bytes=$3,sequence=$4::bigint,expiration=$5::bigint WHERE id=$1::uuid",
    input.claimId,
    input.hash,
    input.signedBytes,
    input.sequence,
    input.expiration,
  );
}

export const messageHandlers = {
  'payment.captured': acceptCapture,
  'payment.review': acceptPaymentReview,
  'refund.confirmed': acceptRefund,
  'claim.confirmed': acceptClaim,
};
