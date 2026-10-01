import { it, expect } from 'vitest';
import sharp from 'sharp';
process.env.DATABASE_URL ||= 'postgresql://unused:unused@localhost/unused_test';
process.env.JWT_SECRET ||= 'isolated-unit-test-secret-at-least-32-characters';
it('decodes, resizes and strips avatar metadata', async () => {
  const { processAvatar } =
    await import('../../apps/api/src/services/identity/avatars');
  const source = await sharp({
    create: { width: 1200, height: 800, channels: 3, background: '#ff00aa' },
  })
    .jpeg()
    .withMetadata()
    .toBuffer();
  const output = await processAvatar(source);
  const m = await sharp(output).metadata();
  expect(m.format).toBe('webp');
  expect(m.width).toBe(512);
  expect(m.height).toBeLessThanOrEqual(512);
  expect(m.exif).toBeUndefined();
  await expect(processAvatar(Buffer.from('fake png'))).rejects.toThrow();
  await expect(
    processAvatar(Buffer.alloc(5 * 1024 * 1024 + 1)),
  ).rejects.toThrow();
  const big = await sharp({
    create: { width: 5000, height: 5000, channels: 3, background: 'black' },
  })
    .png()
    .toBuffer();
  await expect(processAvatar(big)).rejects.toThrow();
  const svg = Buffer.from(
    '<svg width="10" height="10"><rect width="10" height="10"/></svg>',
  );
  await expect(processAvatar(svg)).rejects.toThrow();
});
