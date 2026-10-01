import { id } from '@ticketchain/shared';
import { db, rows, one } from '../../../shared/db';
import { requireValue } from '../../../shared/errors';
import {
  asyncRoute,
  currentUser,
  authenticatedRouter,
} from '../../../shared/http/context';
import { claimCollectible } from '../collectibles';

export const router = authenticatedRouter();
router.get(
  '/',
  asyncRoute(async (_req, res) =>
    res.json(
      await rows(
        db,
        `
          SELECT a.id,a.status,a.checked_at,p.status AS order_status,p.event_id,e.title AS event_title,i.tier_name
          FROM tc_admissionticket a
          JOIN tc_purchase p ON p.id=a.order_id
          JOIN tc_listing e ON e.id=p.event_id
          JOIN tc_allocation al ON al.id=a.allocation_id
          JOIN tc_inventoryunit unit ON unit.id=al.unit_id
          JOIN tc_purchaseitem i ON i.order_id=p.id
          AND i.tier_id=unit.tier_id
          WHERE p.user_id=$1::uuid
          ORDER BY p.created_at DESC
          LIMIT 100
        `,
        currentUser(res).id,
      ),
    ),
  ),
);

router.get(
  '/:id/qr',
  asyncRoute(async (req, res) =>
    res.json(
      requireValue(
        await one(
          db,
          "SELECT a.credential AS code FROM tc_admissionticket a JOIN tc_purchase p ON p.id=a.order_id WHERE a.id=$1::uuid AND p.user_id=$2::uuid AND p.status='paid' AND a.status='valid'",
          id.parse(req.params.id),
          currentUser(res).id,
        ),
      ),
    ),
  ),
);

router.post(
  '/:id/claim',
  asyncRoute(async (req, res) =>
    res.json(await claimCollectible(currentUser(res), id.parse(req.params.id))),
  ),
);
