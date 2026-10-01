import { createHash } from 'node:crypto';
export const demoEventIds = [0, 1, 2].map(
  (i) => `00000000-0000-4000-8000-00000000010${i}`,
);
for (let index = 0; index < 30; index++) {
  const digest = createHash('sha256')
    .update(`expanded-demo-event:${index}`)
    .digest('hex');
  demoEventIds.push(
    `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`,
  );
}
