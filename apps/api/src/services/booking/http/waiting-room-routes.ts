import { id } from '@ticketchain/shared';
import { z } from 'zod';
import { assertRule } from '../../../shared/errors';
import {
  asyncRoute,
  currentUser,
  authenticatedRouter,
} from '../../../shared/http/context';
import { eventDetails } from '../events/queries';
import { waitingRoom } from '../waiting-room';

export const router = authenticatedRouter();
router.post(
  '/:id/waiting-room',
  asyncRoute(async (req, res) => {
    const eventId = id.parse(req.params.id);
    const event = await eventDetails(eventId);
    assertRule(
      event.starts_at > new Date(),
      'SALES_CLOSED',
      'Checkout has closed',
    );
    const operation = z
      .object({ operation: z.enum(['join', 'leave']) })
      .strict()
      .parse(req.body).operation;
    res.json(
      event.waiting_room
        ? await waitingRoom(eventId, currentUser(res).id, operation)
        : { state: 'disabled', position: 0 },
    );
  }),
);

router.get(
  '/:id/waiting-room',
  asyncRoute(async (req, res) => {
    const eventId = id.parse(req.params.id);
    const event = await eventDetails(eventId);
    res.json(
      event.waiting_room
        ? await waitingRoom(eventId, currentUser(res).id, 'status')
        : { state: 'disabled', position: 0 },
    );
  }),
);
