import { randomUUID } from 'node:crypto';
import { config } from '../../shared/config';
import { one, transaction } from '../../shared/db';
import { requireValue, assertRule } from '../../shared/errors';
import { enqueue } from '../../shared/infrastructure/jobs';
import { type Account } from '../../shared/types';

export async function claimCollectible(user: Account, ticketId: string) {
  assertRule(
    user.wallet &&
      config.APTOS_MODULE &&
      config.APTOS_PRIVATE_KEY &&
      config.APTOS_TREASURY,
    'COLLECTIBLES_UNAVAILABLE',
    'Link a wallet and configure the testnet collectible module',
  );
  return transaction(async (tx) => {
    const ticket = requireValue(
      await one<{ id: string; event_id: string }>(
        tx,
        `
          SELECT a.id,p.event_id
          FROM tc_admissionticket a
          JOIN tc_purchase p ON p.id=a.order_id
          WHERE a.id=$1::uuid
          AND p.user_id=$2::uuid
          AND p.status='paid'
          AND a.status IN ('valid','used')
        `,
        ticketId,
        user.id,
      ),
    );
    await tx.$queryRawUnsafe(
      'SELECT id FROM tc_listing WHERE id=$1::uuid FOR UPDATE',
      ticket.event_id,
    );
    const eligible = await one(
      tx,
      "SELECT a.id FROM tc_admissionticket a JOIN tc_purchase p ON p.id=a.order_id WHERE a.id=$1::uuid AND p.status='paid' AND a.status IN ('valid','used')",
      ticketId,
    );
    assertRule(eligible, 'CLAIM_INELIGIBLE', 'Ticket is no longer eligible');
    const c = requireValue(
      await one<{ id: string }>(
        tx,
        'INSERT INTO tc_claim(id,ticket_id,recipient) VALUES($1::uuid,$2::uuid,$3) ON CONFLICT(ticket_id) DO UPDATE SET ticket_id=EXCLUDED.ticket_id RETURNING *',
        randomUUID(),
        ticket.id,
        user.wallet,
      ),
    );
    await enqueue(tx, 'claim', `claim:${c.id}`, { claimId: c.id });
    return c;
  });
}
