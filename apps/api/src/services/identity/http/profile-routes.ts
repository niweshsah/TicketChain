import { profileUpdateSchema } from '@ticketchain/shared';
import express from 'express';
import { db, rows, one, transaction } from '../../../shared/db';
import { assertRule, requireValue } from '../../../shared/errors';
import {
  asyncRoute,
  currentUser,
  authenticatedRouter,
} from '../../../shared/http/context';
import { type Account } from '../../../shared/types';
import { publicUser } from '../auth';
import { replaceAvatar } from '../avatars';
import { walletChallenge, linkWallet } from '../wallet';

export const router = authenticatedRouter();
router.get(
  '/',
  asyncRoute(async (_req, res) => {
    const linked = await rows<{ provider: 'google' | 'github' }>(
      db,
      'SELECT provider FROM tc_oauthidentity WHERE user_id=$1::uuid ORDER BY provider',
      currentUser(res).id,
    );
    res.json({
      ...publicUser(currentUser(res)),
      linkedProviders: linked.map((value) => value.provider),
    });
  }),
);

router.post(
  '/avatar',
  express.raw({
    type: ['image/jpeg', 'image/png', 'image/webp'],
    limit: '5mb',
  }),
  asyncRoute(async (req, res) => {
    assertRule(
      Buffer.isBuffer(req.body),
      'INVALID_IMAGE',
      'Upload a JPEG, PNG or WebP image',
      400,
    );
    res.json(publicUser(await replaceAvatar(currentUser(res).id, req.body)));
  }),
);

router.delete(
  '/avatar',
  asyncRoute(async (_req, res) => {
    res.json(publicUser(await replaceAvatar(currentUser(res).id, null)));
  }),
);

router.patch(
  '/',
  asyncRoute(async (req, res) => {
    const input = profileUpdateSchema.parse(req.body);
    const updated = requireValue(
      await one<Account>(
        db,
        'UPDATE tc_account SET name=$2,home_city=CASE WHEN $3::boolean THEN $4 ELSE home_city END WHERE id=$1::uuid RETURNING *',
        currentUser(res).id,
        input.name,
        input.homeCity !== undefined,
        input.homeCity ?? null,
      ),
    );
    res.json(publicUser(updated));
  }),
);

router.post(
  '/organizer',
  asyncRoute(async (_req, res) => {
    const updated = await transaction(async (tx) =>
      requireValue(
        await one<Account>(
          tx,
          "UPDATE tc_account SET role='organizer' WHERE id=$1::uuid AND active RETURNING *",
          currentUser(res).id,
        ),
      ),
    );
    res.json(publicUser(updated));
  }),
);

router.post(
  '/wallet/challenges',
  asyncRoute(async (req, res) =>
    res.json(await walletChallenge(currentUser(res), req.body)),
  ),
);

router.post(
  '/wallet',
  asyncRoute(async (req, res) =>
    res.json(await linkWallet(currentUser(res), req.body)),
  ),
);
