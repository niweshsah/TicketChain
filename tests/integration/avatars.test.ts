import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test'))
  throw new Error('Use isolated test database');
process.env.DATABASE_URL = url;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= 'avatar-test-secret-at-least-32-characters';
let app: typeof import('../../apps/api/src/app').app;
let db: typeof import('../../apps/api/src/shared/db').db;
let token: string, other: string, id: string;
beforeAll(async () => {
  app = (await import('../../apps/api/src/app')).app;
  db = (await import('../../apps/api/src/shared/db')).db;
  for (let i = 0; i < 2; i++) {
    const r = await request(app)
      .post('/api/v1/auth/register')
      .set('Origin', 'http://localhost:5173')
      .send({
        name: 'Avatar test',
        email: `${randomUUID()}@avatar.test`,
        password: 'Avatar!Password2026',
      })
      .expect(200);
    if (i === 0) {
      token = r.body.accessToken;
      id = r.body.user.id;
    } else other = r.body.accessToken;
  }
});
afterAll(async () => {
  vi.restoreAllMocks();
  await db.$disconnect();
});
it('scopes avatar changes to the authenticated account and preserves old metadata on storage failure', async () => {
  const bytes = await sharp({
    create: { width: 20, height: 20, channels: 3, background: 'purple' },
  })
    .png()
    .toBuffer();
  const objects = new Map<string, Buffer>();
  let fail = false;
  const spy = vi
    .spyOn(S3Client.prototype, 'send')
    .mockImplementation(async (command) => {
      const input = command.input as { Key?: string; Body?: Buffer };
      if (command instanceof PutObjectCommand) {
        if (fail) throw new Error('storage failure');
        objects.set(input.Key!, input.Body!);
      }
      if (command instanceof GetObjectCommand)
        return {
          Body: { transformToByteArray: async () => objects.get(input.Key!) },
        };
      return {};
    });
  await request(app)
    .post('/api/v1/me/avatar')
    .set('Content-Type', 'image/png')
    .send(bytes)
    .expect(401);
  const uploaded = await request(app)
    .post('/api/v1/me/avatar')
    .set('Authorization', `Bearer ${token}`)
    .set('Content-Type', 'image/png')
    .send(bytes)
    .expect(200);
  expect(uploaded.body.avatarUrl).toContain(id);
  await request(app)
    .get(uploaded.body.avatarUrl)
    .expect('Content-Type', /image\/webp/)
    .expect(200);
  fail = true;
  await request(app)
    .post('/api/v1/me/avatar')
    .set('Authorization', `Bearer ${token}`)
    .set('Content-Type', 'image/png')
    .send(bytes)
    .expect(500);
  await request(app)
    .get('/api/v1/me')
    .set('Authorization', `Bearer ${token}`)
    .expect((r) => expect(r.body.avatarUrl).toBe(uploaded.body.avatarUrl));
  await request(app)
    .post('/api/v1/me/avatar')
    .set('Authorization', `Bearer ${token}`)
    .set('Content-Type', 'image/png')
    .send(Buffer.from('fake'))
    .expect(400);
  await request(app)
    .delete('/api/v1/me/avatar')
    .set('Authorization', `Bearer ${other}`)
    .expect(200);
  await request(app)
    .get('/api/v1/me')
    .set('Authorization', `Bearer ${token}`)
    .expect((r) => expect(r.body.avatarUrl).toBe(uploaded.body.avatarUrl));
  await request(app)
    .delete('/api/v1/me/avatar')
    .set('Authorization', `Bearer ${token}`)
    .expect(200)
    .expect((r) => expect(r.body.avatarUrl).toBeNull());
  await request(app)
    .patch('/api/v1/me')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Avatar test', homeCity: 'Arbitrary' })
    .expect(400);
  spy.mockRestore();
});
