import { orderSchema } from '../contracts';
import { client, result } from '../lib/client';
import { orderRows, orderDto, rpc } from './data';

export async function orders() {
  return (await orderRows()).map(orderDto);
}
export async function order(id) {
  const value = (await orderRows()).find((row) => row.id === id);
  if (!value) throw new Error('Order not found');
  return orderDto(value);
}
export async function createOrder(body, key) {
  const value = orderSchema.parse(body);
  if (value.currency !== 'INR') throw new Error('Choose INR');
  const id = await rpc('tc_book_event', {
    p_event_id: value.eventId,
    p_items: value.items,
    p_request_id: key,
  });
  return order(id);
}
export async function refund(id) {
  await rpc('tc_refund_order', { p_order_id: id });
  return order(id);
}
export async function tickets() {
  const data = await result(
    client
      .from('lite_tickets')
      .select(
        '*, order:lite_orders(status,event_title,event:lite_events(title))',
      )
      .order('created_at'),
  );
  return data.map((ticket) => ({
    ...ticket,
    event_title:
      ticket.order.event_title || ticket.order.event?.title || 'Event',
    order_status: ticket.order.status,
  }));
}
export async function qr(id) {
  const ticket = await result(
    client.from('lite_tickets').select('code,status').eq('id', id).single(),
  );
  if (ticket.status !== 'valid')
    throw new Error('This ticket is no longer valid');
  return { code: ticket.code };
}
export async function attendees(id) {
  return rpc('tc_attendees', { p_event_id: id });
}
export async function summary(id) {
  return rpc('tc_summary', { p_event_id: id });
}
export async function checkIn(id, code) {
  return { id: await rpc('tc_check_in', { p_event_id: id, p_code: code }) };
}
