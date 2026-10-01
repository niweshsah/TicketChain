import { randomUUID, createHash, createPublicKey, verify } from 'node:crypto';
import { z } from 'zod';
import { config } from '../../shared/config';
import { db, one, transaction } from '../../shared/db';
import { requireValue, assertRule } from '../../shared/errors';
import { type Account } from '../../shared/types';
import { address, normalize } from '../../shared/wallet-address';

export async function walletChallenge(user: Account, body: unknown) {
  const input = z.object({ wallet: address }).strict().parse(body);
  const id = randomUUID();
  const message = `Link TicketChain wallet\nUser: ${user.id}\nWallet: ${normalize(input.wallet)}\nDomain: ${config.WEB_ORIGIN}\nNetwork: aptos-testnet\nChallenge: ${id}`;
  await db.$executeRawUnsafe(
    "INSERT INTO tc_walletchallenge(id,user_id,wallet,message,expires_at) VALUES($1::uuid,$2::uuid,$3,$4,now()+interval '5 minutes')",
    id,
    user.id,
    normalize(input.wallet),
    message,
  );
  return { id, message, nonce: id, domain: config.WEB_ORIGIN, chainId: 2 };
}

export async function linkWallet(user: Account, body: unknown) {
  const input = z
    .object({
      challengeId: z.string().uuid(),
      publicKey: z.string().regex(/^(0x)?[0-9a-fA-F]{64}$/),
      signature: z.string().regex(/^(0x)?[0-9a-fA-F]{128}$/),
      fullMessage: z.string().max(2000),
    })
    .strict()
    .parse(body);
  return transaction(async (tx) => {
    const challenge = requireValue(
      await one<{
        id: string;
        wallet: string;
        message: string;
        valid: boolean;
        used: boolean;
      }>(
        tx,
        'SELECT *,expires_at>now() AS valid FROM tc_walletchallenge WHERE id=$1::uuid AND user_id=$2::uuid FOR UPDATE',
        input.challengeId,
        user.id,
      ),
    );
    assertRule(
      challenge.valid && !challenge.used,
      'CHALLENGE_EXPIRED',
      'Challenge expired or already used',
    );
    const pub = Buffer.from(input.publicKey.replace(/^0x/, ''), 'hex');
    const derived = `0x${createHash('sha3-256')
      .update(Buffer.concat([pub, Buffer.from([0])]))
      .digest('hex')}`;
    assertRule(
      derived === challenge.wallet,
      'UNSUPPORTED_WALLET',
      'Only unrotated standard Ed25519 accounts are supported',
      400,
    );
    const expected = `APTOS\naddress: ${challenge.wallet}\napplication: ${config.WEB_ORIGIN}\nchainId: 2\nmessage: ${challenge.message}\nnonce: ${challenge.id}`;
    assertRule(
      input.fullMessage === expected,
      'WALLET_DOMAIN_MISMATCH',
      'Wallet message must bind address, application, chainId, message, and nonce',
      400,
    );
    const key = createPublicKey({
      key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), pub]),
      format: 'der',
      type: 'spki',
    });
    assertRule(
      verify(
        null,
        Buffer.from(expected),
        key,
        Buffer.from(input.signature.replace(/^0x/, ''), 'hex'),
      ),
      'WALLET_FORGERY',
      'Invalid wallet signature',
      400,
    );
    await tx.$executeRawUnsafe(
      'UPDATE tc_walletchallenge SET used=true WHERE id=$1::uuid',
      challenge.id,
    );
    await tx.$executeRawUnsafe(
      'UPDATE tc_account SET wallet=$2 WHERE id=$1::uuid',
      user.id,
      challenge.wallet,
    );
    return { wallet: challenge.wallet };
  });
}
