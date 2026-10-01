import { Router } from 'express';
import { asyncRoute } from '../../../shared/http/context';
import { searchEvents } from '../search';

export const router = Router();
router.get(
  '/events',
  asyncRoute(async (req, res) => res.json(await searchEvents(req.query))),
);
