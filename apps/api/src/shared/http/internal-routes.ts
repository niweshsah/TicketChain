import { Router } from 'express';
import { router as booking } from '../../services/booking/http/internal-routes';
import { router as identity } from '../../services/identity/http/internal-routes';
import { internalAuthentication } from './internal-authentication';

export const internalRouter = Router();
internalRouter.use(internalAuthentication, identity, booking);
