import express, { Router } from 'express';
import { asyncRoute } from '../../../shared/http/context';
import { ingestWebhook } from '../webhooks';

export const router = Router();
router.post(
  '/api/v1/webhooks/razorpay',
  express.raw({ type: 'application/json', limit: '256kb' }),
  asyncRoute(async (req, res) => {
    await ingestWebhook(
      req.body as Buffer,
      req.get('x-razorpay-signature') || '',
      req.get('x-razorpay-event-id') || '',
    );
    res.status(202).json({ accepted: true });
  }),
);
