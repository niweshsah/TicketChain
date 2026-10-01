import { Router } from 'express';
import { db } from '../db';
import { asyncRoute } from './context';

export const router = Router();
router.get('/health/live', (_req, res) => {
  res.json({ alive: true });
});

router.get(
  '/health/ready',
  asyncRoute(async (_req, res) => {
    await db.$queryRawUnsafe('SELECT 1');
    res.json({ ready: true });
  }),
);
