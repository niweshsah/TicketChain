import { z } from 'zod';

export const address = z.string().regex(/^0x[0-9a-fA-F]{1,64}$/);

export const normalize = (s: string) =>
  `0x${s.replace(/^0x/, '').toLowerCase().padStart(64, '0')}`;
