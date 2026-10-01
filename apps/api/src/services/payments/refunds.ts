import { db, one } from '../../shared/db';
import { demoPaymentsAllowed } from '../../shared/config';
import { assertRule, requireValue } from '../../shared/errors';
import { type Purchase, type Operation } from '../../shared/types';
import { RazorRefund, razor, AmbiguousOperation } from './razorpay/client';

export async function submitRefund(orderId: string, extraPayment?: string) {
  const pay = requireValue(
    await one<Operation>(
      db,
      "SELECT * FROM tc_provideroperation WHERE order_id=$1::uuid AND kind='payment'",
      orderId,
    ),
  );
  const operation = requireValue(
    await one<Operation>(
      db,
      'SELECT * FROM tc_provideroperation WHERE order_id=$1::uuid AND kind=$2',
      orderId,
      extraPayment ? `extra:${extraPayment}` : 'refund',
    ),
  );
  if (operation.status === 'confirmed') return;
  const paymentId = requireValue(extraPayment || pay.payment_id);
  const order = requireValue(
    await one<Purchase>(
      db,
      'SELECT * FROM tc_purchase WHERE id=$1::uuid',
      orderId,
    ),
  );
  if (pay.provider === 'demo') {
    assertRule(
      demoPaymentsAllowed,
      'DEMO_DISABLED',
      'Demo payments are disabled',
    );
    await db.$executeRawUnsafe(
      "UPDATE tc_provideroperation SET status='confirmed',external_id=$2 WHERE id=$1::uuid",
      operation.id,
      `demo_refund_${operation.id}`,
    );
    return;
  }
  if (pay.provider === 'aptos') {
    const { refundApt } = await import('./aptos/refunds');
    await refundApt(
      operation,
      extraPayment
        ? { ...order, total: BigInt(String(operation.data.amount)) }
        : order,
      requireValue(
        (extraPayment ? operation.data.sender : pay.data.sender) as
          string | undefined,
      ),
    );
    return;
  }
  let refund: RazorRefund | undefined;
  if (operation.external_id)
    refund = await razor<RazorRefund>(`/refunds/${operation.external_id}`);
  else if (operation.status !== 'intent') {
    const result = await razor<{ items: RazorRefund[] }>(
      `/payments/${paymentId}/refunds`,
    );
    refund = result.items.find((r) => r.notes?.operationId === operation.id);
    if (!refund)
      throw new AmbiguousOperation(
        'Refund submission uncertain; provider has no matching evidence yet',
      );
  }
  if (!refund) {
    const changed = await db.$executeRawUnsafe(
      "UPDATE tc_provideroperation SET status='submitting' WHERE id=$1::uuid AND status='intent'",
      operation.id,
    );
    if (!changed)
      throw new AmbiguousOperation('Refund submission already started');
    refund = await razor<RazorRefund>(`/payments/${paymentId}/refund`, 'POST', {
      amount: Number(extraPayment ? operation.data.amount : order.total),
      notes: { operationId: operation.id },
    });
  }
  assertRule(
    refund.payment_id === paymentId &&
      BigInt(refund.amount) ===
        BigInt(extraPayment ? String(operation.data.amount) : order.total),
    'REFUND_MISMATCH',
    'Refund does not match payment',
  );
  await db.$executeRawUnsafe(
    'UPDATE tc_provideroperation SET external_id=$2,status=$3 WHERE id=$1::uuid',
    operation.id,
    refund.id,
    refund.status === 'processed' ? 'confirmed' : 'submitted',
  );
  if (refund.status !== 'processed') {
    if (refund.status === 'failed')
      throw new AmbiguousOperation('Refund failed; manual review required');
    throw new Error('Refund still processing');
  }
}
