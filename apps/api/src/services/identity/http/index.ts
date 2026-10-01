import { Router } from 'express';
import { router as authenticationRoutes } from './auth-routes';
import { router as socialSignInRoutes } from './oauth-routes';
import { router as profileRoutes } from './profile-routes';
export const router = Router();
router.use(authenticationRoutes, socialSignInRoutes);
router.use('/me', profileRoutes);
