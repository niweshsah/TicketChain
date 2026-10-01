import { db, rows, one } from '../../../shared/db';
import { requireValue } from '../../../shared/errors';
import { type Purchase } from '../../../shared/types';

export async function orderDetails(userId: string, orderId: string) {
  const order = requireValue(
    await one<Purchase & { event_title: string }>(
      db,
      `
        SELECT p.*,e.title AS event_title,EXISTS(SELECT 1
        FROM tc_provideroperation op
        WHERE op.order_id=p.id
        AND op.status='uncertain') AS financial_review
        FROM tc_purchase p
        JOIN tc_listing e ON e.id=p.event_id
        WHERE p.id=$1::uuid
        AND p.user_id=$2::uuid
      `,
      orderId,
      userId,
    ),
  );
  const items = await rows(
    db,
    'SELECT tier_id,tier_name,price,quantity FROM tc_purchaseitem WHERE order_id=$1::uuid ORDER BY tier_id',
    orderId,
  );
  return { ...order, items };
}
