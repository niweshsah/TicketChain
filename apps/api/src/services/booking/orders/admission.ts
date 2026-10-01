import { one, transaction } from '../../../shared/db';
import { assertRule, requireValue } from '../../../shared/errors';
import { type Account, type Purchase } from '../../../shared/types';
import { lockEvent } from '../events/queries';

export async function checkIn(user: Account, eventId: string, code: string) {
  return transaction(async (tx) => {
    const event = await lockEvent(tx, eventId);
    assertRule(
      event.owner_id === user.id && user.role === 'organizer',
      'FORBIDDEN',
      'Only the owning organizer may check in tickets',
      403,
    );
    assertRule(
      event.status === 'published' && event.ends_at > event.now,
      'ADMISSION_CLOSED',
      'Admission is closed',
    );
    const ticketReference = requireValue(
      await one<{ order_id: string }>(
        tx,
        'SELECT a.order_id FROM tc_admissionticket a JOIN tc_purchase p ON p.id=a.order_id WHERE credential=$1 AND p.event_id=$2::uuid',
        code,
        eventId,
      ),
      'INVALID_TICKET',
    );
    const purchase = requireValue(
      await one<Purchase>(
        tx,
        'SELECT * FROM tc_purchase WHERE id=$1::uuid FOR UPDATE',
        ticketReference.order_id,
      ),
    );
    assertRule(
      purchase.status === 'paid',
      'ADMISSION_BLOCKED',
      'Refund or financial review blocks admission',
    );
    const ticket = await one(
      tx,
      "UPDATE tc_admissionticket SET checked_at=now(),status='used' WHERE credential=$1 AND status='valid' AND checked_at IS NULL RETURNING id,checked_at",
      code,
    );
    assertRule(
      ticket,
      'ALREADY_USED',
      'Ticket has already been used or blocked',
    );
    return ticket;
  });
}
