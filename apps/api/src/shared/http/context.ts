import express, {
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import { authenticate } from '../authentication';
import { config } from '../config';
import { assertRule } from '../errors';
import { type Account } from '../types';

export const asyncRoute =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res).catch(next);
  };

export function requireApplicationOrigin(req: Request) {
  assertRule(
    req.get('origin') === config.WEB_ORIGIN,
    'ORIGIN_REJECTED',
    'Exact application origin required',
    403,
  );
}

export const currentUser = (res: Response): Account =>
  res.locals.user as Account;
export function authenticatedRouter() {
  const router = express.Router();
  router.use((req, res, next) => {
    // A request may pass through several feature routers; authenticate it once.
    if (res.locals.user) return next();
    void authenticate(req.get('authorization'))
      .then((account) => {
        res.setHeader('Cache-Control', 'no-store');
        res.locals.user = account;
        next();
      })
      .catch(next);
  });
  return router;
}
