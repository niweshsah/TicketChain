import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, it, expect } from 'vitest';
import request from 'supertest';

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test'))
  throw new Error('Use an isolated *_test database');
process.env.DATABASE_URL = url;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= 'isolated-profile-test-secret-at-least-32';
process.env.WEB_ORIGIN = 'http://localhost:5173';
let app: typeof import('../../apps/api/src/app').app;
let db: typeof import('../../apps/api/src/shared/db').db;
beforeAll(async () => {
  app = (await import('../../apps/api/src/app')).app;
  db = (await import('../../apps/api/src/shared/db')).db;
});
afterAll(async () => {
  await db.$disconnect();
});
it('edits a public profile and enables organizing without losing attendee purchases', async () => {
  const registration = await request(app)
    .post('/api/v1/auth/register')
    .set('Origin', 'http://localhost:5173')
    .send({
      name: 'Profile attendee',
      email: `${randomUUID()}@profile.test`,
      password: 'Profile!Password2026',
      role: 'attendee',
    })
    .expect(200);
  const token = registration.body.accessToken as string;
  const accountId = registration.body.user.id as string;
  await request(app)
    .patch('/api/v1/me')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Updated attendee' })
    .expect(200)
    .expect((response) => expect(response.body.name).toBe('Updated attendee'));
  await request(app)
    .patch('/api/v1/me')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Updated', role: 'organizer' })
    .expect(400);
  await request(app)
    .post('/api/v1/me/organizer')
    .set('Authorization', `Bearer ${token}`)
    .expect(200)
    .expect((response) => {
      expect(response.body.id).toBe(accountId);
      expect(response.body.capabilities).toEqual(['attendee', 'organizer']);
      expect(response.body.password_hash).toBeUndefined();
    });
  await request(app)
    .post('/api/v1/me/organizer')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  await request(app)
    .get('/api/v1/organizer/events')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  await request(app)
    .get('/api/v1/orders')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  await request(app).patch('/api/v1/me').send({ name: 'Forged' }).expect(401);
});
