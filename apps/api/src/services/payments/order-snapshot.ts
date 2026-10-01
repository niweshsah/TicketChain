import { config } from '../../shared/config';
import { db } from '../../shared/db';
import { serviceRequest } from '../../shared/service-client';
import { type Purchase } from '../../shared/types';

export async function synchronizeOrder(orderId: string) {
  const snapshot = await serviceRequest<Purchase & { sellable: boolean }>(
    config.BOOKING_URL,
    `/internal/orders/${orderId}`,
  );
  await db.$executeRawUnsafe(
    `
      INSERT INTO tc_purchase(id,user_id,event_id,idem_key,fingerprint,currency,total,status,expires_at,created_at) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7::bigint,$8,$9::timestamptz,$10::timestamptz) ON CONFLICT(id)
      DO UPDATE SET status=EXCLUDED.status,expires_at=EXCLUDED.expires_at
    `,
    snapshot.id,
    snapshot.user_id,
    snapshot.event_id,
    snapshot.idem_key,
    snapshot.fingerprint,
    snapshot.currency,
    String(snapshot.total),
    snapshot.status,
    String(snapshot.expires_at),
    String(snapshot.created_at),
  );
  return snapshot;
}
