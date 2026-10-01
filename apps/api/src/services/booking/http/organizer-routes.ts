import { id, codeSchema } from '@ticketchain/shared';
import { db, rows } from '../../../shared/db';
import { assertRule } from '../../../shared/errors';
import {
  asyncRoute,
  currentUser,
  authenticatedRouter,
} from '../../../shared/http/context';
import { eventDetails } from '../events/queries';
import { checkIn } from '../orders/admission';

export const router = authenticatedRouter();
router.get(
  '/:id/attendees',
  asyncRoute(async (req, res) => {
    const eventId = id.parse(req.params.id);
    const e = await eventDetails(eventId, currentUser(res).id);
    assertRule(
      e.owner_id === currentUser(res).id,
      'FORBIDDEN',
      'You do not own this event',
      403,
    );
    res.json(
      await rows(
        db,
        `
          SELECT a.id,a.status,a.checked_at,u.name,p.id AS order_id,p.status AS order_status
          FROM tc_admissionticket a
          JOIN tc_purchase p ON p.id=a.order_id
          JOIN tc_account u ON u.id=p.user_id
          WHERE p.event_id=$1::uuid
          ORDER BY a.id
        `,
        eventId,
      ),
    );
  }),
);

router.get(
  '/:id/summary',
  asyncRoute(async (req, res) => {
    const eventId = id.parse(req.params.id);
    const e = await eventDetails(eventId, currentUser(res).id);
    assertRule(
      e.owner_id === currentUser(res).id,
      'FORBIDDEN',
      'You do not own this event',
      403,
    );
    res.json(
      await rows(
        db,
        'SELECT status,currency,count(*)::int AS orders,sum(total)::text AS total FROM tc_purchase WHERE event_id=$1::uuid GROUP BY status,currency ORDER BY status',
        eventId,
      ),
    );
  }),
);

router.post(
  '/:id/check-in',
  asyncRoute(async (req, res) =>
    res.json(
      await checkIn(
        currentUser(res),
        id.parse(req.params.id),
        codeSchema.parse(req.body).code,
      ),
    ),
  ),
);
