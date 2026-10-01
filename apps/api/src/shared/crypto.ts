import { createHash } from 'node:crypto';

export const hash = (v: string) => createHash('sha256').update(v).digest('hex');
