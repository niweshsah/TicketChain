import { id } from '@ticketchain/shared';
import { Router } from 'express';
import { config } from '../../../shared/config';
import { db, one } from '../../../shared/db';
import { AppError, requireValue } from '../../../shared/errors';
import { type Account } from '../../../shared/types';

export const router = Router();
router.get('/accounts/:id', (req, res, next) => {
  if (config.SERVICE_NAME !== 'identity')
    return next(new AppError(404, 'NOT_FOUND', 'Route not found'));
  void one<Account>(
    db,
    'SELECT id,name,email,role,active,wallet FROM tc_account WHERE id=$1::uuid AND active',
    id.parse(req.params.id),
  )
    .then((account) => res.json(requireValue(account)))
    .catch(next);
});
