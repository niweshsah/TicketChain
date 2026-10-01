import { randomUUID } from 'node:crypto';
import { config, demoPaymentsAllowed } from '../../shared/config';
import { db, one, transaction } from '../../shared/db';
import { assertRule, requireValue } from '../../shared/errors';
import { enqueue } from '../../shared/infrastructure/jobs';
import {
  type Account,
  type Purchase,
  type Operation,
} from '../../shared/types';
import { lockEvent } from '../../shared/standalone';
import { synchronizeOrder } from './order-snapshot';
import { AmbiguousOperation, razor, RazorOrder } from './razorpay/client';

export async function initializePayment(user: Account, orderId: string) {
  const snapshot =
    config.SERVICE_NAME === 'payments'
      ? await synchronizeOrder(orderId)
      : undefined;
  if (snapshot)
    assertRule(
      snapshot.user_id === user.id && snapshot.sellable,
      'ORDER_CLOSED',
      'This order is not awaiting payment',
      409,
    );
  const order = requireValue(
    await one<Purchase>(
      db,
      'SELECT * FROM tc_purchase WHERE id=$1::uuid AND user_id=$2::uuid',
      orderId,
      user.id,
    ),
  );
  assertRule(
    order.currency === 'APT' ||
      config.PAYMENT_PROVIDER !== 'demo' ||
      demoPaymentsAllowed,
    'DEMO_DISABLED',
    'Demo payments are disabled',
  );
  assertRule(
    order.status === 'held',
    'ORDER_CLOSED',
    'Order is no longer awaiting payment',
  );
  const operation = await transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
      `payment:${orderId}`,
    );
    if (!snapshot) {
      const event = await lockEvent(tx, order.event_id);
      assertRule(
        event.status === 'published' &&
          event.starts_at > event.now &&
          order.expires_at > event.now,
        'SALES_CLOSED',
        'Checkout or hold has closed',
      );
    }
    const prior = await one<Operation>(
      tx,
      "SELECT * FROM tc_provideroperation WHERE order_id=$1::uuid AND kind='payment'",
      orderId,
    );
    if (prior) return prior;
    const provider =
      order.currency === 'APT' ? 'aptos' : config.PAYMENT_PROVIDER;
    const created = requireValue(
      await one<Operation>(
        tx,
        "INSERT INTO tc_provideroperation(id,order_id,kind,provider) VALUES($1::uuid,$2::uuid,'payment',$3) RETURNING *",
        randomUUID(),
        orderId,
        provider,
      ),
    );
    await enqueue(tx, 'initialize', `initialize:${created.id}`, {
      operationId: created.id,
    });
    return created;
  });
  return {
    operationId: operation.id,
    status: operation.status,
    provider: operation.provider,
    providerOrderId: operation.external_id,
    keyId:
      operation.provider === 'razorpay' ? config.RAZORPAY_KEY_ID : undefined,
    amount: order.total.toString(),
    currency: order.currency,
    treasury:
      operation.provider === 'aptos' ? config.APTOS_TREASURY : undefined,
  };
}

export async function runInitialize(operationId: string) {
  const operation = requireValue(
    await one<Operation>(
      db,
      'SELECT * FROM tc_provideroperation WHERE id=$1::uuid',
      operationId,
    ),
  );
  assertRule(
    operation.provider !== 'demo' || demoPaymentsAllowed,
    'DEMO_DISABLED',
    'Demo payments are disabled',
  );
  if (
    operation.external_id ||
    operation.status === 'ready' ||
    operation.status === 'captured'
  )
    return;
  if (operation.status === 'submitting' || operation.status === 'uncertain')
    throw new AmbiguousOperation(
      'Order initialization requires provider reconciliation by receipt; do not create another order',
    );
  const order = requireValue(
    await one<Purchase>(
      db,
      'SELECT * FROM tc_purchase WHERE id=$1::uuid',
      operation.order_id,
    ),
  );
  const remote =
    config.SERVICE_NAME === 'payments'
      ? await synchronizeOrder(order.id)
      : undefined;
  const sellable = remote
    ? remote.sellable
    : await one(
        db,
        "SELECT p.id FROM tc_purchase p JOIN tc_listing e ON e.id=p.event_id WHERE p.id=$1::uuid AND p.status='held' AND p.expires_at>now() AND e.status='published' AND e.starts_at>now()",
        order.id,
      );
  if (!sellable) {
    await db.$executeRawUnsafe(
      "UPDATE tc_provideroperation SET status='closed' WHERE id=$1::uuid AND status='intent'",
      operation.id,
    );
    return;
  }
  const changed = await db.$executeRawUnsafe(
    "UPDATE tc_provideroperation SET status='submitting' WHERE id=$1::uuid AND status='intent'",
    operation.id,
  );
  if (!changed)
    throw new AmbiguousOperation('Initialization already submitted');
  try {
    const external =
      operation.provider === 'razorpay'
        ? (
            await razor<RazorOrder>('/orders', 'POST', {
              amount: Number(order.total),
              currency: 'INR',
              receipt: order.id,
              partial_payment: false,
            })
          ).id
        : `${operation.provider}_${operation.id}`;
    await db.$executeRawUnsafe(
      "UPDATE tc_provideroperation SET external_id=$2,status='ready' WHERE id=$1::uuid",
      operation.id,
      external,
    );
    if (operation.provider === 'razorpay')
      await transaction((tx) =>
        enqueue(
          tx,
          'reconcile',
          `reconcile:${operation.id}`,
          { operationId: operation.id },
          30,
        ),
      );
  } catch (e) {
    await db.$executeRawUnsafe(
      "UPDATE tc_provideroperation SET status='uncertain' WHERE id=$1::uuid",
      operation.id,
    );
    throw e;
  }
}
