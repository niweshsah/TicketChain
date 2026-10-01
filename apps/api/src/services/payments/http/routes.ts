import { id } from '@ticketchain/shared';
import { z } from 'zod';
import {
  asyncRoute,
  currentUser,
  authenticatedRouter,
} from '../../../shared/http/context';
import { confirmPayment } from '../confirmation';
import { initializePayment } from '../initialization';

export const router = authenticatedRouter();
router.post(
  '/initialize',
  asyncRoute(async (req, res) =>
    res.json(
      await initializePayment(
        currentUser(res),
        z.object({ orderId: id }).strict().parse(req.body).orderId,
      ),
    ),
  ),
);

router.post(
  '/confirm',
  asyncRoute(async (req, res) =>
    res.json(await confirmPayment(currentUser(res), req.body)),
  ),
);
