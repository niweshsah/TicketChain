import { config } from '../../shared/config';
import { db, one, rows, transaction } from '../../shared/db';
import { requireValue } from '../../shared/errors';
import { enqueue } from '../../shared/infrastructure/jobs';
import { publishIntent } from '../../shared/infrastructure/messages';
import { type Purchase, type Operation, type Job } from '../../shared/types';
import { treasurySubmit } from '../../shared/standalone';
import { AmbiguousOperation } from '../../shared/provider-errors';
import { lockEvent, lockTiers } from './events/queries';
import { expireEvent } from './orders/inventory';
import { queueRefund } from './orders/refunds';

export async function processBookingJob(job: Job) {
  const payload = job.payload;
  switch (job.kind) {
    case 'expire':
      await transaction(async (tx) => {
        await lockEvent(tx, payload.eventId);
        await lockTiers(tx, payload.eventId);
        await expireEvent(tx, payload.eventId);
      });
      break;

    case 'cancel':
      await transaction(async (tx) => {
        await lockEvent(tx, payload.eventId);
        await lockTiers(tx, payload.eventId);
        const orders = await rows<Purchase>(
          tx,
          "SELECT * FROM tc_purchase WHERE event_id=$1::uuid AND status IN ('paid','held','expired') ORDER BY id FOR UPDATE LIMIT 100",
          payload.eventId,
        );
        for (const order of orders) {
          if (order.status === 'paid')
            await queueRefund(tx, order, 'event cancellation');
          if (['held', 'expired'].includes(order.status)) {
            await tx.$executeRawUnsafe(
              "UPDATE tc_purchase SET status='cancelled' WHERE id=$1::uuid",
              order.id,
            );
            await tx.$executeRawUnsafe(
              "UPDATE tc_allocation SET active=false,state='cancelled' WHERE order_id=$1::uuid AND state='held'",
              order.id,
            );
          }
        }
        if (orders.length === 100)
          await enqueue(
            tx,
            'cancel',
            `cancel-batch:${payload.eventId}:${job.id}`,
            {
              eventId: payload.eventId,
            },
          );
      });
      break;

    case 'claim': {
      const claim = requireValue(
        await one<{
          id: string;
          ticket_id: string;
          recipient: string;
          order_id: string;
          status: string;
        }>(
          db,
          'SELECT c.*,a.order_id FROM tc_claim c JOIN tc_admissionticket a ON a.id=c.ticket_id WHERE c.id=$1::uuid',
          payload.claimId,
        ),
      );
      if (claim.status === 'confirmed') return;
      if (config.SERVICE_NAME === 'booking') {
        await transaction((tx) =>
          publishIntent(
            tx,
            'claim.requested',
            claim.order_id,
            {
              claimId: claim.id,
              ticketId: claim.ticket_id,
              recipient: claim.recipient,
              orderId: claim.order_id,
            },
            'payments',
            `claim:${claim.id}`,
          ),
        );
        return;
      }
      await db.$executeRawUnsafe(
        "INSERT INTO tc_provideroperation(id,order_id,kind,provider) VALUES($1::uuid,$2::uuid,$3,'aptos') ON CONFLICT(order_id,kind) DO NOTHING",
        claim.id,
        claim.order_id,
        `claim:${claim.id}`,
      );
      await treasurySubmit(claim.id, {
        function: `${requireValue(config.APTOS_MODULE)}::collectibles::mint`,
        functionArguments: [
          claim.ticket_id,
          claim.recipient,
          `Ticket ${claim.ticket_id}`,
          'https://ticketchain.local/collectible',
        ],
      });
      const operation = requireValue(
        await one<Operation>(
          db,
          'SELECT * FROM tc_provideroperation WHERE id=$1::uuid',
          claim.id,
        ),
      );
      await db.$executeRawUnsafe(
        "UPDATE tc_claim SET status='confirmed',tx_hash=$2,signed_bytes=$3,sequence=$4::bigint,expiration=$5::bigint WHERE id=$1::uuid",
        claim.id,
        operation.external_id,
        String(operation.data.transaction),
        String(operation.data.sequence),
        String(operation.data.expiration),
      );
      await db.$executeRawUnsafe(
        "UPDATE tc_provideroperation SET status='confirmed' WHERE id=$1::uuid",
        claim.id,
      );
      break;
    }
    default:
      throw new AmbiguousOperation('Unknown job type');
  }
}
