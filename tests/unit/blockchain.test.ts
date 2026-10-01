import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  normalizeAddress,
  verifyTransfer,
} from '../../packages/blockchain/src';
const hash = `0x${'a'.repeat(64)}`;
const fixture = {
  type: 'user_transaction',
  hash,
  sender: '0x1',
  success: true,
  timestamp: '1000000000',
  payload: {
    function: '0x1::aptos_account::transfer',
    arguments: ['0x2', '100000000'],
    type_arguments: [],
  },
};
afterEach(() => vi.unstubAllGlobals());
function responses(tx = fixture, chain = 2) {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ chain_id: chain }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => tx }),
  );
}
describe('Aptos committed-transfer fixture', () => {
  it('accepts exact testnet sender, treasury, amount and timing', async () => {
    responses();
    expect(
      (
        await verifyTransfer(
          hash,
          '0x1',
          '0x2',
          100000000n,
          new Date(999000),
          new Date(1001000),
        )
      ).amount,
    ).toBe(100000000n);
  });
  it('rejects wrong network, forged sender, amount, recipient, failure and late timing', async () => {
    for (const tx of [
      { ...fixture, sender: '0x3' },
      { ...fixture, success: false },
      {
        ...fixture,
        payload: { ...fixture.payload, arguments: ['0x3', '100000000'] },
      },
      { ...fixture, payload: { ...fixture.payload, arguments: ['0x2', '1'] } },
      { ...fixture, timestamp: '2000000000' },
    ]) {
      responses(tx);
      await expect(
        verifyTransfer(
          hash,
          '0x1',
          '0x2',
          100000000n,
          new Date(999000),
          new Date(1001000),
        ),
      ).rejects.toThrow();
    }
    responses(fixture, 1);
    await expect(
      verifyTransfer(
        hash,
        '0x1',
        '0x2',
        100000000n,
        new Date(999000),
        new Date(1001000),
      ),
    ).rejects.toThrow('testnet');
  });
  it('normalizes addresses and rejects invalid inputs', () => {
    expect(normalizeAddress('0x1')).toHaveLength(66);
    expect(() => normalizeAddress('not-a-wallet')).toThrow();
  });
});
