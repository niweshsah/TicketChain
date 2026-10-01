import { config } from '../../shared/config';
import { db, one, transaction } from '../../shared/db';
import { requireValue } from '../../shared/errors';
import { publishIntent } from '../../shared/infrastructure/messages';
import { type Operation, type Job } from '../../shared/types';
import { finishRefund } from '../../shared/standalone';
import { runInitialize } from './initialization';
import { AmbiguousOperation } from './razorpay/client';
import { reconcilePayment } from './reconciliation';
import { submitRefund } from './refunds';

export async function processPaymentJob(job: Job) {
  const payload = job.payload;
  switch (job.kind) {
    case 'initialize':
      await runInitialize(payload.operationId);
      break;

    case 'reconcile':

    case 'demo-capture':
      await reconcilePayment(payload.operationId);
      break;

    case 'refund':
      await submitRefund(payload.orderId);
      if (config.SERVICE_NAME === 'payments')
        await transaction((tx) =>
          publishIntent(
            tx,
            'refund.confirmed',
            payload.orderId,
            { orderId: payload.orderId },
            'booking',
            `refund-confirmed:${payload.orderId}`,
          ),
        );
      else await finishRefund(payload.orderId);
      break;

    case 'extra-refund':
      await submitRefund(payload.orderId, payload.paymentId);
      break;

    case 'webhook': {
      const webhook = requireValue(
        await one<{
          payload: {
            payload?: {
              payment?: { entity?: { order_id?: string } };
              refund?: { entity?: { payment_id?: string } };
            };
          };
        }>(
          db,
          'SELECT payload FROM tc_webhookevent WHERE id=$1',
          payload.eventId,
        ),
      );
      const providerOrderId =
        webhook.payload.payload?.payment?.entity?.order_id;
      const paymentId = webhook.payload.payload?.refund?.entity?.payment_id;
      const operation = providerOrderId
        ? await one<Operation>(
            db,
            "SELECT * FROM tc_provideroperation WHERE external_id=$1 AND kind='payment'",
            providerOrderId,
          )
        : await one<Operation>(
            db,
            "SELECT * FROM tc_provideroperation WHERE payment_id=$1 AND kind='payment'",
            paymentId || '',
          );
      if (!operation && (providerOrderId || paymentId))
        throw new Error('Awaiting persisted provider operation');
      if (operation) {
        if (paymentId) {
          await submitRefund(operation.order_id);
          if (config.SERVICE_NAME === 'payments')
            await transaction((tx) =>
              publishIntent(
                tx,
                'refund.confirmed',
                operation.order_id,
                { orderId: operation.order_id },
                'booking',
                `refund-confirmed:${operation.order_id}`,
              ),
            );
          else await finishRefund(operation.order_id);
        } else await reconcilePayment(operation.id);
      }
      break;
    }
    default:
      throw new AmbiguousOperation('Unknown job type');
  }
}
