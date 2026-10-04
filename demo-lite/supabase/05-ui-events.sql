-- All event changes lock one event row, serializing organizer edits and bookings.
create or replace function public.tc_save_event(p_event_id uuid, p_event jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
#variable_conflict use_variable
declare
  event public.lite_events; tier public.lite_tiers; item jsonb;
  event_id uuid; tier_id uuid; seen uuid[] := '{}';
  starts timestamptz := (p_event->>'startsAt')::timestamptz;
  ends timestamptz := (p_event->>'endsAt')::timestamptz;
  entry_time timestamptz := (p_event->>'entryAt')::timestamptz;
  qty integer; price integer; has_orders boolean; metadata jsonb;
begin
  if auth.uid() is null then raise exception 'Please sign in'; end if;
  if starts is null or ends is null or starts <= now() or ends <= starts then
    raise exception 'Choose a future start and an end after start';
  end if;
  if entry_time is not null and (entry_time > starts or entry_time < starts - interval '24 hours') then
    raise exception 'Entry must be within 24 hours before start';
  end if;
  if not exists(select 1 from pg_timezone_names where name = p_event->>'timezone') then
    raise exception 'Choose a valid event timezone';
  end if;
  if coalesce(p_event->>'category','') not in ('Concert','Festival','Comedy','Jazz','Acoustic','Electronic','Theatre','Workshop') then
    raise exception 'Choose an event category';
  end if;
  if p_event->>'agePolicy' is not null and p_event->>'agePolicy' not in ('All ages','5+','12+','16+','18+','21+') then
    raise exception 'Choose an age policy';
  end if;
  if coalesce(p_event->>'imageUrl','') !~ '^https://' or char_length(p_event->>'imageUrl') > 2000 then
    raise exception 'Use an HTTPS image URL';
  end if;
  if char_length(coalesce(p_event->>'venueAddress','')) > 500 or char_length(coalesce(p_event->>'accessibilityNotes','')) > 2000 then
    raise exception 'Venue address or accessibility notes are too long';
  end if;
  if jsonb_typeof(p_event->'tiers') is distinct from 'array' or jsonb_array_length(p_event->'tiers') not between 1 and 10 then
    raise exception 'Add between one and ten ticket tiers';
  end if;
  if jsonb_typeof(coalesce(p_event->'performers','[]')) <> 'array'
    or jsonb_array_length(coalesce(p_event->'performers','[]')) > 20
    or exists(select 1 from jsonb_array_elements_text(coalesce(p_event->'performers','[]')) v where char_length(trim(v)) not between 1 and 100) then
    raise exception 'Add up to twenty performer names, each up to 100 characters';
  end if;
  if jsonb_typeof(coalesce(p_event->'languages','[]')) <> 'array'
    or jsonb_array_length(coalesce(p_event->'languages','[]')) > 15
    or exists(select 1 from jsonb_array_elements_text(coalesce(p_event->'languages','[]')) v
      where v not in ('Hindi','English','Kannada','Tamil','Telugu','Marathi','Bengali','Malayalam','Gujarati','Punjabi','Odia','Assamese','Urdu','Instrumental')) then
    raise exception 'Choose languages from the list';
  end if;
  metadata := jsonb_build_object(
    'category',p_event->'category','timezone',p_event->'timezone','imageUrl',p_event->'imageUrl',
    'endsAt',p_event->'endsAt','entryAt',p_event->'entryAt','performers',coalesce(p_event->'performers','[]'),
    'languages',coalesce(p_event->'languages','[]'),'agePolicy',p_event->'agePolicy',
    'venueAddress',p_event->'venueAddress','accessibilityNotes',p_event->'accessibilityNotes'
  );
  if p_event_id is null then
    insert into public.lite_events(owner_id,title,description,city,venue,starts_at,price_paise,capacity,available,metadata)
    values(auth.uid(),p_event->>'title',p_event->>'description',p_event->>'city',p_event->>'venue',starts,100,1,1,metadata)
    returning id into event_id;
  else
    select * into event from public.lite_events where id = p_event_id for update;
    if not found or event.owner_id is distinct from auth.uid() then raise exception 'Event not found'; end if;
    if event.lifecycle not in ('draft','published') then raise exception 'This event is closed'; end if;
    select exists(select 1 from public.lite_orders where lite_orders.event_id = event.id) into has_orders;
    if has_orders and (starts <> event.starts_at or
      coalesce(event.metadata->>'endsAt',p_event->>'endsAt') <> p_event->>'endsAt' or
      coalesce(event.metadata->>'timezone','Asia/Kolkata') <> p_event->>'timezone') then
      raise exception 'Dates and timezone cannot change after a booking';
    end if;
    event_id := event.id;
    update public.lite_events set title=p_event->>'title',description=p_event->>'description',city=p_event->>'city',
      venue=p_event->>'venue',starts_at=starts,metadata=metadata where id=event_id;
  end if;
  for item in select value from jsonb_array_elements(p_event->'tiers') loop
    qty := (item->>'quantity')::integer; price := (item->>'pricePaise')::integer;
    if qty is null or price is null or price < 100 then raise exception 'Enter a tier price of at least ₹1 and valid inventory'; end if;
    if jsonb_typeof(coalesce(item->'inclusions','[]')) <> 'array'
      or jsonb_array_length(coalesce(item->'inclusions','[]')) > 10
      or exists(select 1 from jsonb_array_elements_text(coalesce(item->'inclusions','[]')) v where char_length(trim(v)) not between 1 and 200) then
      raise exception 'Add up to ten inclusions, each up to 200 characters';
    end if;
    if item->>'id' is null then
      insert into public.lite_tiers(event_id,name,price_paise,quantity,available,inclusions)
      values(event_id,item->>'name',price,qty,qty,coalesce(item->'inclusions','[]')) returning id into tier_id;
    else
      tier_id := (item->>'id')::uuid;
      select * into tier from public.lite_tiers where id=tier_id and lite_tiers.event_id=event_id for update;
      if not found or tier.status <> 'active' then raise exception 'Ticket tier not found'; end if;
      if tier_id = any(seen) then raise exception 'Duplicate tier'; end if;
      if exists(select 1 from public.lite_orders o where o.event_id=event_id and o.items @> jsonb_build_array(jsonb_build_object('tier_id',tier_id)))
        and price <> tier.price_paise then raise exception 'Sold tier prices cannot change'; end if;
      if qty < tier.quantity-tier.available then raise exception 'Inventory cannot be below booked tickets'; end if;
      update public.lite_tiers set name=item->>'name',price_paise=price,quantity=qty,
        available=qty-(tier.quantity-tier.available),inclusions=coalesce(item->'inclusions','[]') where id=tier_id;
    end if;
    seen := array_append(seen,tier_id);
  end loop;
  for tier in select * from public.lite_tiers where lite_tiers.event_id=event_id and status='active' and not(id=any(seen)) loop
    if exists(select 1 from public.lite_orders o where o.event_id=event_id and o.items @> jsonb_build_array(jsonb_build_object('tier_id',tier.id))) then
      update public.lite_tiers set status='retired' where id=tier.id;
    else delete from public.lite_tiers where id=tier.id; end if;
  end loop;
  update public.lite_events set capacity=(select sum(quantity) from public.lite_tiers where lite_tiers.event_id=event_id),
    available=(select sum(available) from public.lite_tiers where lite_tiers.event_id=event_id),
    price_paise=(select min(price_paise) from public.lite_tiers where lite_tiers.event_id=event_id and status='active') where id=event_id;
  -- Editing a live listing must continue to satisfy publication requirements.
  if (select published from public.lite_events where id=event_id) then perform public.tc_transition_event(event_id,'publish'); end if;
  return event_id;
end $$;
revoke all on function public.tc_save_event(uuid,jsonb) from public, anon;
grant execute on function public.tc_save_event(uuid,jsonb) to authenticated;
