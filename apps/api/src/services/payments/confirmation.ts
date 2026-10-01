import { paymentSchema } from '@ticketchain/shared';
import { config, demoPaymentsAllowed } from '../../shared/config';
import { db, one, transaction } from '../../shared/db';
import { AppError, assertRule, requireValue } from '../../shared/errors';
import { enqueue } from '../../shared/infrastructure/jobs';
import { publishIntent } from '../../shared/infrastructure/messages';
import {
  type Account,
  type Purchase,
  type Operation,
} from '../../shared/types';
import { recordCapture } from './captures';
import { synchronizeOrder } from './order-snapshot';
import {
  validHmac,
  razor,
  RazorPayment,
  validateCaptured,
} from './razorpay/client';

export async function confirmPayment(user: Account, body: unknown) {
  const input = paymentSchema.parse(body);
  if (config.SERVICE_NAME === 'payments') await synchronizeOrder(input.orderId);
  const order = requireValue(
    await one<Purchase>(
      db,
      'SELECT * FROM tc_purchase WHERE id=$1::uuid AND user_id=$2::uuid',
      input.orderId,
      user.id,
    ),
  );
  const operation = requireValue(
    await one<Operation>(
      db,
      "SELECT * FROM tc_provideroperation WHERE order_id=$1::uuid AND kind='payment'",
      order.id,
    ),
  );
  if (operation.provider === 'demo') {
    assertRule(demoPaymentsAllowed, 'DEMO_DISABLED', 'Demo disabled');
    if (operation.status === 'uncertain') return { status: 'payment_pending' };
    if (input.scenario === 'failure')
      throw new AppError(
        402,
        'PAYMENT_FAILED',
        'Demo payment failed; your hold remains until expiry',
      );
    if (input.scenario === 'uncertain') {
      await transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          "UPDATE tc_provideroperation SET status='uncertain',data=data || '{\"scenario\":\"uncertain\"}'::jsonb WHERE id=$1::uuid AND status<>'captured'",
          operation.id,
        );
        await publishIntent(
          tx,
          'payment.review',
          order.id,
          {
            orderId: order.id,
            operationId: operation.id,
            provider: operation.provider,
            externalId: operation.external_id,
            reason: 'Provider outcome requires reconciliation',
          },
          'booking',
          `review:${operation.id}`,
        );
        await enqueue(tx, 'reconcile', `uncertain:${operation.id}`, {
          operationId: operation.id,
        });
      });
      return { status: 'payment_pending' };
    }
    if (input.scenario === 'delayed') {
      await transaction((tx) =>
        enqueue(
          tx,
          'demo-capture',
          `demo:${operation.id}`,
          { operationId: operation.id },
          5,
        ),
      );
      return { status: 'payment_pending' };
    }
    await recordCapture(
      order.id,
      `demo_${operation.id}`,
      order.total,
      order.currency,
    );
  } else if (operation.provider === 'razorpay') {
    assertRule(
      operation.external_id && input.paymentId && input.signature,
      'PAYMENT_REQUIRED',
      'Checkout evidence is required',
      400,
    );
    assertRule(
      validHmac(
        config.RAZORPAY_KEY_SECRET!,
        `${operation.external_id}|${input.paymentId}`,
        input.signature,
      ),
      'INVALID_SIGNATURE',
      'Invalid payment signature',
      400,
    );
    const payment = await razor<RazorPayment>(
      `/payments/${encodeURIComponent(input.paymentId)}`,
    );
    validateCaptured(payment, order, operation.external_id);
    await recordCapture(
      order.id,
      payment.id,
      BigInt(payment.amount),
      payment.currency,
    );
  } else {
    assertRule(
      input.transactionHash,
      'TRANSACTION_REQUIRED',
      'A committed testnet transaction is required',
      400,
    );
    const { verifyTransfer } = await import('@ticketchain/blockchain');
    const evidence = await verifyTransfer(
      input.transactionHash,
      requireValue(user.wallet),
      config.APTOS_TREASURY!,
      order.total,
      order.created_at,
      order.expires_at,
    );
    await recordCapture(
      order.id,
      evidence.hash,
      evidence.amount,
      'APT',
      evidence.sender,
    );
  }
  return {
    status: config.SERVICE_NAME === 'payments' ? 'payment_pending' : 'paid',
  };
}
