import { id } from '@ticketchain/shared';
import { z } from 'zod';
import { db, rows } from '../../../shared/db';
import { assertRule } from '../../../shared/errors';
import {
  asyncRoute,
  currentUser,
  authenticatedRouter,
} from '../../../shared/http/context';
import { saveEvent } from '../events/editor';
import { transitionEvent } from '../events/lifecycle';
import { eventDetails } from '../events/queries';

export const router = authenticatedRouter();
router.get(
  '/',
  asyncRoute(async (_req, res) => {
    assertRule(
      currentUser(res).role === 'organizer',
      'FORBIDDEN',
      'Organizer account required',
      403,
    );
    const events = await rows<{ id: string }>(
      db,
      'SELECT id FROM tc_listing WHERE owner_id=$1::uuid ORDER BY created_at DESC',
      currentUser(res).id,
    );
    res.json(
      await Promise.all(
        events.map((e) => eventDetails(e.id, currentUser(res).id)),
      ),
    );
  }),
);

router.post(
  '/',
  asyncRoute(async (req, res) =>
    res.status(201).json(await saveEvent(currentUser(res), req.body)),
  ),
);

router.put(
  '/:id',
  asyncRoute(async (req, res) =>
    res.json(
      await saveEvent(currentUser(res), req.body, id.parse(req.params.id)),
    ),
  ),
);

router.get(
  '/:id/preview',
  asyncRoute(async (req, res) => {
    const e = await eventDetails(id.parse(req.params.id), currentUser(res).id);
    assertRule(
      e.owner_id === currentUser(res).id,
      'FORBIDDEN',
      'You do not own this event',
      403,
    );
    res.json(e);
  }),
);

router.post(
  '/:id/:action(publish|cancel|finish)',
  asyncRoute(async (req, res) =>
    res.json(
      await transitionEvent(
        currentUser(res),
        id.parse(req.params.id),
        z.enum(['publish', 'cancel', 'finish']).parse(req.params.action),
      ),
    ),
  ),
);
