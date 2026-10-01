import { db, one } from '../../shared/db';
import { demoPaymentsAllowed } from '../../shared/config';
import { assertRule, requireValue } from '../../shared/errors';
import { type Purchase, type Operation } from '../../shared/types';
import { recordCapture } from './captures';
import {
  AmbiguousOperation,
  razor,
  RazorPayment,
  validateCaptured,
} from './razorpay/client';

export async function reconcilePayment(operationId: string) {
  const operation = requireValue(
    await one<Operation>(
      db,
      'SELECT * FROM tc_provideroperation WHERE id=$1::uuid',
      operationId,
    ),
  );
  if (operation.status === 'captured') return;
  const order = requireValue(
    await one<Purchase>(
      db,
      'SELECT * FROM tc_purchase WHERE id=$1::uuid',
      operation.order_id,
    ),
  );
  if (operation.provider === 'demo') {
    assertRule(
      demoPaymentsAllowed,
      'DEMO_DISABLED',
      'Demo payments are disabled',
    );
    if (operation.data.scenario === 'uncertain')
      throw new AmbiguousOperation(
        'Demo uncertain outcome requires manual review',
      );
    await recordCapture(
      order.id,
      `demo_${operation.id}`,
      order.total,
      order.currency,
    );
    return;
  }
  if (operation.provider === 'aptos')
    throw new AmbiguousOperation('Await a committed transaction hash');
  assertRule(
    operation.external_id,
    'PROVIDER_ORDER_REQUIRED',
    'Provider order is unavailable',
  );
  const payments = await razor<{ items: RazorPayment[] }>(
    `/orders/${operation.external_id}/payments`,
  );
  for (const providerPayment of payments.items.filter(
    (providerPayment) => providerPayment.status === 'captured',
  )) {
    validateCaptured(providerPayment, order, operation.external_id);
    await recordCapture(
      order.id,
      providerPayment.id,
      BigInt(providerPayment.amount),
      providerPayment.currency,
    );
  }
  if (
    !payments.items.some(
      (providerPayment) => providerPayment.status === 'captured',
    )
  )
    throw new Error('No captured payment yet');
}
