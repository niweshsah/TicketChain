import { config } from './config';

// Direct domain calls are reserved for the local, single-database development mode.
// Deployed services communicate through internal HTTP and durable messages.
function requireStandalone() {
  if (config.SERVICE_NAME !== 'standalone')
    throw new Error('Standalone adapter used by a deployed service');
}

export async function fulfill(
  ...args: Parameters<
    typeof import('../services/booking/orders/fulfillment').fulfill
  >
) {
  requireStandalone();
  const domain = await import('../services/booking/orders/fulfillment');
  return domain.fulfill(...args);
}

export async function finishRefund(
  ...args: Parameters<
    typeof import('../services/booking/orders/refunds').finishRefund
  >
) {
  requireStandalone();
  const domain = await import('../services/booking/orders/refunds');
  return domain.finishRefund(...args);
}

export async function lockEvent(
  ...args: Parameters<
    typeof import('../services/booking/events/queries').lockEvent
  >
) {
  requireStandalone();
  const domain = await import('../services/booking/events/queries');
  return domain.lockEvent(...args);
}

export async function treasurySubmit(
  ...args: Parameters<
    typeof import('../services/payments/aptos/treasury').treasurySubmit
  >
) {
  requireStandalone();
  const domain = await import('../services/payments/aptos/treasury');
  return domain.treasurySubmit(...args);
}
