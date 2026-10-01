import { Router } from 'express';
import { router as paymentRoutes } from './routes';
export const router = Router();
router.use('/payments', paymentRoutes);
