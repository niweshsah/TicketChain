create or replace function public.tc_book_event(p_event_id uuid,p_items jsonb,p_request_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  event public.lite_events; tier public.lite_tiers; previous public.lite_orders;
  item jsonb; snapshot jsonb := '[]'; canonical jsonb; qty integer; count integer := 0;
  total integer := 0; result uuid; ticket_number integer;
begin
  if auth.uid() is null then raise exception 'Please sign in'; end if;
  if p_request_id is null or p_event_id is null or jsonb_typeof(p_items) is distinct from 'array'
    or jsonb_array_length(p_items) not between 1 and 10 then raise exception 'Choose your tickets'; end if;
  if exists(select 1 from jsonb_array_elements(p_items) i
    where (i->>'quantity') is null or (i->>'quantity') !~ '^[1-9][0-9]*$'
      or (i->>'quantity')::integer > 10 or i->>'tierId' is null) then
    raise exception 'Choose between one and ten tickets';
  end if;
  if (select count(distinct i->>'tierId') from jsonb_array_elements(p_items) i) <> jsonb_array_length(p_items) then
    raise exception 'Duplicate ticket tier';
  end if;
  select jsonb_agg(value order by value->>'tierId') into canonical from jsonb_array_elements(p_items);
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':' || p_request_id::text,0));
  select * into previous from public.lite_orders where user_id=auth.uid() and request_id=p_request_id;
  if found then
    if previous.event_id is distinct from p_event_id or previous.request_payload is distinct from canonical then
      raise exception 'This request was already used for different tickets'; end if;
    return previous.id;
  end if;
  select * into event from public.lite_events where id=p_event_id for update;
  if not found or not event.published or event.lifecycle <> 'published' or event.starts_at <= now() then
    raise exception 'This event is not accepting bookings'; end if;
  for item in select value from jsonb_array_elements(canonical) loop
    qty := (item->>'quantity')::integer; count := count+qty;
    if count > 10 then raise exception 'Choose no more than ten tickets'; end if;
    select * into tier from public.lite_tiers where id=(item->>'tierId')::uuid and event_id=event.id for update;
    if not found or tier.status <> 'active' then raise exception 'This tier is no longer available'; end if;
    if tier.available < qty then raise exception 'Not enough tickets left. Choose a smaller quantity'; end if;
    total := total + tier.price_paise*qty;
    snapshot := snapshot || jsonb_build_array(jsonb_build_object('tier_id',tier.id,'tier_name',tier.name,'price',tier.price_paise,'quantity',qty));
    update public.lite_tiers set available=available-qty where id=tier.id;
  end loop;
  insert into public.lite_orders(user_id,event_id,request_id,quantity,total_paise,items,request_payload,event_title)
    values(auth.uid(),event.id,p_request_id,count,total,snapshot,canonical,event.title) returning id into result;
  for item in select value from jsonb_array_elements(snapshot) loop
    for ticket_number in 1..(item->>'quantity')::integer loop
      insert into public.lite_tickets(order_id,event_id,tier_id,tier_name)
      values(result,event.id,(item->>'tier_id')::uuid,item->>'tier_name');
    end loop;
  end loop;
  update public.lite_events set available=available-count where id=event.id;
  return result;
end $$;

create or replace function public.tc_refund_order(p_order_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare purchase public.lite_orders; event public.lite_events; item jsonb;
begin
  if auth.uid() is null then raise exception 'Please sign in'; end if;
  -- All operations lock the event first to avoid booking/refund/check-in deadlocks.
  select e.* into event from public.lite_events e join public.lite_orders o on o.event_id=e.id
    where o.id=p_order_id and (o.user_id=auth.uid() or e.owner_id=auth.uid()) for update of e;
  if not found then raise exception 'Booking not found'; end if;
  select * into purchase from public.lite_orders where id=p_order_id for update;
  if purchase.status='refunded' then return; end if;
  if event.lifecycle <> 'cancelled' and event.starts_at <= now() then raise exception 'Refunds close when the event starts'; end if;
  if exists(select 1 from public.lite_tickets where order_id=purchase.id and status='checked_in') then
    raise exception 'Used tickets cannot be refunded'; end if;
  update public.lite_orders set status='refunded' where id=purchase.id;
  update public.lite_tickets set status='refunded' where order_id=purchase.id;
  for item in select value from jsonb_array_elements(purchase.items) loop
    update public.lite_tiers set available=available+(item->>'quantity')::integer where id=(item->>'tier_id')::uuid;
  end loop;
  update public.lite_events set available=available+purchase.quantity where id=event.id;
end $$;

create or replace function public.tc_transition_event(p_event_id uuid,p_action text)
returns void language plpgsql security definer set search_path = '' as $$
declare event public.lite_events; purchase public.lite_orders;
begin
  if auth.uid() is null then raise exception 'Please sign in'; end if;
  select * into event from public.lite_events where id=p_event_id for update;
  if not found or event.owner_id is distinct from auth.uid() then raise exception 'Only the event owner can change this event'; end if;
  if p_action='publish' then
    if event.lifecycle not in ('draft','published') or event.starts_at <= now() then raise exception 'Only future active events can be published'; end if;
    if trim(event.description)='' or trim(coalesce(event.metadata->>'venueAddress',''))=''
      or jsonb_array_length(coalesce(event.metadata->'languages','[]'))=0 or event.metadata->>'agePolicy' is null then
      raise exception 'Add description, venue address, languages and age policy before publishing'; end if;
    if event.metadata->>'category' in ('Concert','Festival','Jazz','Acoustic','Electronic')
      and jsonb_array_length(coalesce(event.metadata->'performers','[]'))=0 then raise exception 'Add a performer before publishing'; end if;
    if not exists(select 1 from public.lite_tiers where event_id=event.id and status='active') then raise exception 'Add an active ticket tier'; end if;
    update public.lite_events set published=true,lifecycle='published' where id=event.id;
  elsif p_action='cancel' then
    if event.lifecycle not in ('draft','published') then raise exception 'This event is already closed'; end if;
    if exists(select 1 from public.lite_tickets where event_id=event.id and status='checked_in') then raise exception 'Resolve checked-in tickets before cancelling'; end if;
    update public.lite_events set published=false,lifecycle='cancelled' where id=event.id;
    for purchase in select * from public.lite_orders where event_id=event.id and status='paid' loop
      perform public.tc_refund_order(purchase.id);
    end loop;
  elsif p_action='finish' then
    if event.lifecycle <> 'published' or (event.metadata->>'endsAt')::timestamptz > now() or event.starts_at > now() then
      raise exception 'Finish an event after its end'; end if;
    update public.lite_events set published=false,lifecycle='finished' where id=event.id;
  else raise exception 'Choose a valid event action'; end if;
end $$;

revoke all on function public.tc_book_event(uuid,jsonb,uuid) from public, anon;
revoke all on function public.tc_refund_order(uuid) from public, anon;
revoke all on function public.tc_transition_event(uuid,text) from public, anon;
grant execute on function public.tc_book_event(uuid,jsonb,uuid) to authenticated;
grant execute on function public.tc_refund_order(uuid) to authenticated;
grant execute on function public.tc_transition_event(uuid,text) to authenticated;
-- Retire the old write paths after the new UI is installed to keep stock consistent.
revoke execute on function public.lite_create_event(text,text,text,text,timestamptz,integer,integer,integer) from authenticated;
revoke execute on function public.lite_publish_event(uuid) from authenticated;
revoke execute on function public.lite_book_event(uuid,integer,uuid) from authenticated;
revoke execute on function public.lite_refund_order(uuid) from authenticated;
notify pgrst, 'reload schema';
