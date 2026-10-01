import { Router } from 'express';
import { asyncRoute } from '../../../shared/http/context';
import { discover } from '../events/queries';

// The local, single-process development server reads Booking directly.
// The deployed discovery endpoint belongs to Catalog.

export const router = Router();
router.get(
  '/events',
  asyncRoute(async (req, res) => res.json(await discover(req.query))),
);
