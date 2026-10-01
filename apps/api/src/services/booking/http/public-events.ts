import { id } from '@ticketchain/shared';
import { Router } from 'express';
import { asyncRoute } from '../../../shared/http/context';
import { eventDetails } from '../events/queries';

export const router = Router();
router.get(
  '/events/:id',
  asyncRoute(async (req, res) =>
    res.json(await eventDetails(id.parse(req.params.id))),
  ),
);
