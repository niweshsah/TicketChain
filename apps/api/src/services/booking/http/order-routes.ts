import { id } from '@ticketchain/shared';
import { db, rows } from '../../../shared/db';
import {
  asyncRoute,
  currentUser,
  authenticatedRouter,
} from '../../../shared/http/context';
import { enforceRateLimit } from '../../../shared/http/rate-limit';
import { orderDetails } from '../orders/queries';
import { requestRefund } from '../orders/refunds';
import { createOrder } from '../orders/reservations';

export const router = authenticatedRouter();
router.post(
  '/',
  asyncRoute(async (req, res) => {
    await enforceRateLimit(`checkout:${currentUser(res).id}`, 30);
    res
      .status(201)
      .json(
        await createOrder(
          currentUser(res),
          req.body,
          req.get('idempotency-key') || '',
        ),
      );
  }),
);

router.get(
  '/',
  asyncRoute(async (_req, res) => {
    const orders = await rows<{ id: string }>(
      db,
      'SELECT id FROM tc_purchase WHERE user_id=$1::uuid ORDER BY created_at DESC LIMIT 100',
      currentUser(res).id,
    );
    res.json(
      await Promise.all(
        orders.map((o) => orderDetails(currentUser(res).id, o.id)),
      ),
    );
  }),
);

router.get(
  '/:id',
  asyncRoute(async (req, res) =>
    res.json(await orderDetails(currentUser(res).id, id.parse(req.params.id))),
  ),
);

router.post(
  '/:id/refund',
  asyncRoute(async (req, res) =>
    res.json(await requestRefund(currentUser(res), id.parse(req.params.id))),
  ),
);
