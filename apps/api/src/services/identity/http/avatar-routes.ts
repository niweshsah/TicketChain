import { Router } from 'express';
import { asyncRoute } from '../../../shared/http/context';
import { avatarImage } from '../avatars';

export const router = Router();
router.get(
  '/api/v1/me/avatar/image/:userId/:file',
  asyncRoute(async (req, res) => {
    const result = await avatarImage(`${req.params.userId}/${req.params.file}`);
    res.set({
      'Content-Type': 'image/webp',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    });
    res.send(result);
  }),
);
