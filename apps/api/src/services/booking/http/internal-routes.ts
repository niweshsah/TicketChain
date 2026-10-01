import { id } from '@ticketchain/shared';
import { Router } from 'express';
import { config } from '../../../shared/config';
import { db, one, rows } from '../../../shared/db';
import { AppError, requireValue } from '../../../shared/errors';
import { type Listing, type Purchase } from '../../../shared/types';
import { eventDetails } from '../events/queries';

export const router = Router();
router.get('/orders/:id', (req, res, next) => {
  if (config.SERVICE_NAME !== 'booking')
    return next(new AppError(404, 'NOT_FOUND', 'Route not found'));
  void (async () => {
    const order = requireValue(
      await one<Purchase & { sellable: boolean }>(
        db,
        `
          SELECT p.*,e.status='published'
          AND e.starts_at>now()
          AND p.status='held'
          AND p.expires_at>now() AS sellable
          FROM tc_purchase p
          JOIN tc_listing e ON e.id=p.event_id
          WHERE p.id=$1::uuid
        `,
        id.parse(req.params.id),
      ),
    );
    res.json(order);
  })().catch(next);
});

router.get('/events/:id', (req, res, next) => {
  if (config.SERVICE_NAME !== 'booking')
    return next(new AppError(404, 'NOT_FOUND', 'Route not found'));
  void (async () => {
    const event = requireValue(
      await one<Listing>(
        db,
        'SELECT * FROM tc_listing WHERE id=$1::uuid',
        id.parse(req.params.id),
      ),
    );
    res.json(await eventDetails(event.id, event.owner_id));
  })().catch(next);
});

router.get('/events', (_req, res, next) => {
  if (config.SERVICE_NAME !== 'booking')
    return next(new AppError(404, 'NOT_FOUND', 'Route not found'));
  void rows<{ id: string }>(
    db,
    "SELECT e.id,COALESCE(v.version,1)::int AS version FROM tc_listing e LEFT JOIN tc_aggregateversion v ON v.id='event.refresh:'||e.id ORDER BY e.id",
  )
    .then((result) => res.json(result))
    .catch(next);
});
