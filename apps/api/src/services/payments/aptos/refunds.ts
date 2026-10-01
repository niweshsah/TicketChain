import { db } from '../../../shared/db';
import { type Operation, type Purchase } from '../../../shared/types';
import { treasurySubmit } from './treasury';

export async function refundApt(
  op: Operation,
  order: Purchase,
  sender: string,
) {
  await treasurySubmit(op.id, {
    function: '0x1::aptos_account::transfer',
    functionArguments: [sender, order.total.toString()],
  });
  await db.$executeRawUnsafe(
    "UPDATE tc_provideroperation SET status='confirmed' WHERE id=$1::uuid",
    op.id,
  );
}
