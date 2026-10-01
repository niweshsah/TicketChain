import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function configure(environment: string, allow?: string) {
  vi.stubEnv(
    'DATABASE_URL',
    'postgresql://unused:unused@localhost/unused_test',
  );
  vi.stubEnv('JWT_SECRET', 'isolated-unit-test-secret-at-least-32-characters');
  vi.stubEnv('NODE_ENV', environment);
  vi.stubEnv('ALLOW_DEMO_PAYMENTS', allow);
  vi.resetModules();
  return import('../../apps/api/src/shared/config');
}

it('blocks production demo payments unless explicitly enabled', async () => {
  expect((await configure('production')).demoPaymentsAllowed).toBe(false);
  expect((await configure('production', 'false')).demoPaymentsAllowed).toBe(
    false,
  );
  expect((await configure('production', 'true')).demoPaymentsAllowed).toBe(
    true,
  );
  expect((await configure('development')).demoPaymentsAllowed).toBe(true);
  await expect(configure('production', '1')).rejects.toThrow();
});

it('rejects payment initialization before creating an operation when disabled', async () => {
  await configure('production', 'false');
  const transaction = vi.fn();
  vi.doMock('../../apps/api/src/shared/db', async (original) => ({
    ...(await original<typeof import('../../apps/api/src/shared/db')>()),
    one: vi.fn(async () => ({ currency: 'INR' })),
    transaction,
  }));
  const { initializePayment } =
    await import('../../apps/api/src/services/payments/initialization');
  await expect(
    initializePayment({ id: 'unused' } as never, 'unused'),
  ).rejects.toMatchObject({ code: 'DEMO_DISABLED' });
  expect(transaction).not.toHaveBeenCalled();
  vi.doUnmock('../../apps/api/src/shared/db');
});
