-- PostgreSQL owns prices and stock. A retry cannot create a second purchase.
create or replace function public.lite_book_event(p_event_id uuid, p_quantity integer, p_request_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  existing public.lite_orders;
  event public.lite_events;
  result uuid;
begin
  if auth.uid() is null then raise exception 'Please sign in'; end if;
  if p_event_id is null or p_quantity is null or p_quantity < 1 or p_quantity > 10 or p_request_id is null then
    raise exception 'Choose between 1 and 10 tickets';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':' || p_request_id::text, 0));
  select * into existing from public.lite_orders where user_id = auth.uid() and request_id = p_request_id;
  if found then
    if existing.event_id is distinct from p_event_id or existing.quantity <> p_quantity then
      raise exception 'This booking request was already used for different tickets';
    end if;
    return existing.id;
  end if;
  select * into event from public.lite_events where id = p_event_id for update;
  if not found or not event.published or event.starts_at <= now() then
    raise exception 'This event is not accepting bookings';
  end if;
  if event.available < p_quantity then raise exception 'Not enough tickets left. Choose a smaller quantity'; end if;
  insert into public.lite_orders(user_id,event_id,request_id,quantity,total_paise)
    values(auth.uid(),event.id,p_request_id,p_quantity,event.price_paise * p_quantity) returning id into result;
  update public.lite_events set available = available - p_quantity where id = event.id;
  return result;
end $$;

create or replace function public.lite_refund_order(p_order_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare purchase public.lite_orders; event public.lite_events;
begin
  if auth.uid() is null then raise exception 'Please sign in'; end if;
  select * into purchase from public.lite_orders
    where id = p_order_id and user_id = auth.uid() for update;
  if not found then raise exception 'Booking not found'; end if;
  if purchase.status = 'refunded' then return; end if;
  select * into event from public.lite_events where id = purchase.event_id for update;
  if event.starts_at <= now() then raise exception 'Refunds close when the event starts'; end if;
  update public.lite_orders set status = 'refunded' where id = purchase.id;
  update public.lite_events set available = available + purchase.quantity where id = event.id;
end $$;

revoke all on function public.lite_book_event(uuid,integer,uuid) from public, anon;
revoke all on function public.lite_refund_order(uuid) from public, anon;
grant execute on function public.lite_book_event(uuid,integer,uuid) to authenticated;
grant execute on function public.lite_refund_order(uuid) to authenticated;
