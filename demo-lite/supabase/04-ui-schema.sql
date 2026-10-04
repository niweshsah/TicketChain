-- Additive upgrade: preserves existing events, orders and inventory.
begin;
alter table public.lite_events add column if not exists metadata jsonb not null default '{}';
alter table public.lite_events add column if not exists lifecycle text not null default 'draft';
update public.lite_events set lifecycle = 'published' where published and lifecycle = 'draft';
alter table public.lite_events drop constraint if exists lite_events_city_check;
alter table public.lite_events add constraint lite_events_city_check check (city in (
  'Bengaluru','Mumbai','Delhi','Hyderabad','Chennai','Pune','Kolkata','Ahmedabad','Jaipur','Kochi',
  'Lucknow','Chandigarh','Goa','Indore','Bhopal','Surat','Vadodara','Nagpur','Nashik','Coimbatore',
  'Thiruvananthapuram','Visakhapatnam','Bhubaneswar','Guwahati','Patna','Ranchi','Mysuru','Mangaluru','Dehradun','Amritsar'
));
alter table public.lite_events drop constraint if exists lite_events_capacity_check;
alter table public.lite_events add constraint lite_events_capacity_check check (capacity between 1 and 100000);
alter table public.lite_events drop constraint if exists lite_events_price_paise_check;
alter table public.lite_events add constraint lite_events_price_paise_check check (price_paise between 0 and 100000000);
alter table public.lite_events drop constraint if exists lite_events_title_check;
alter table public.lite_events add constraint lite_events_title_check check (char_length(trim(title)) between 3 and 160);
alter table public.lite_events drop constraint if exists lite_events_description_check;
alter table public.lite_events add constraint lite_events_description_check check (char_length(description) <= 10000);

-- Only replace the exact original copy of the six known seed events.
update public.lite_events set description='An evening of live music, friends, and an unforgettable atmosphere. General admission includes entry.'
where id::text ~ '^00000000-0000-4000-8000-00000000000[1-6]$'
  and description='A fictional TicketChain demo experience with live music, friends, and an unforgettable evening. General admission includes entry. No real money is charged.';

create table if not exists public.lite_tiers (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.lite_events(id),
  name text not null check (char_length(trim(name)) between 1 and 80),
  price_paise integer not null check (price_paise between 0 and 100000000),
  quantity integer not null check (quantity between 1 and 10000),
  available integer not null check (available between 0 and quantity),
  status text not null default 'active' check (status in ('active','retired')),
  inclusions jsonb not null default '[]' check (jsonb_typeof(inclusions) = 'array' and jsonb_array_length(inclusions) <= 10)
);
-- Event IDs double as the IDs of legacy general-admission tiers.
insert into public.lite_tiers(id,event_id,name,price_paise,quantity,available)
select e.id,e.id,'General admission',e.price_paise,e.capacity,e.available from public.lite_events e
where not exists(select 1 from public.lite_tiers t where t.event_id=e.id)
on conflict (id) do nothing;
alter table public.lite_orders add column if not exists items jsonb;
alter table public.lite_orders add column if not exists request_payload jsonb;
alter table public.lite_orders add column if not exists event_title text;
update public.lite_orders o set items = jsonb_build_array(jsonb_build_object(
  'tier_id',o.event_id,'tier_name','General admission','price',o.total_paise/o.quantity,'quantity',o.quantity
)), event_title = e.title from public.lite_events e where e.id = o.event_id and o.items is null;

create table if not exists public.lite_tickets (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.lite_orders(id),
  event_id uuid not null references public.lite_events(id),
  tier_id uuid not null references public.lite_tiers(id),
  tier_name text not null,
  code text not null unique default replace(gen_random_uuid()::text,'-',''),
  status text not null default 'valid' check (status in ('valid','checked_in','refunded')),
  checked_at timestamptz,
  created_at timestamptz not null default now()
);
-- Existing bookings receive admission records once, without changing stock.
insert into public.lite_tickets(order_id,event_id,tier_id,tier_name,status)
select o.id,o.event_id,(i->>'tier_id')::uuid,i->>'tier_name',case when o.status='refunded' then 'refunded' else 'valid' end
from public.lite_orders o cross join lateral jsonb_array_elements(o.items) i
cross join lateral generate_series(1,(i->>'quantity')::integer) n
where not exists(select 1 from public.lite_tickets t where t.order_id=o.id);
create index if not exists lite_tiers_event on public.lite_tiers(event_id);
create index if not exists lite_tickets_order on public.lite_tickets(order_id);
create index if not exists lite_tickets_event on public.lite_tickets(event_id);
alter table public.lite_tiers enable row level security;
alter table public.lite_tickets enable row level security;
drop policy if exists lite_tiers_read on public.lite_tiers;
create policy lite_tiers_read on public.lite_tiers for select to anon, authenticated using (
  exists(select 1 from public.lite_events e where e.id = event_id and
    ((e.published and status = 'active') or e.owner_id = auth.uid()))
);
drop policy if exists lite_tickets_read on public.lite_tickets;
create policy lite_tickets_read on public.lite_tickets for select to authenticated using (
  exists(select 1 from public.lite_orders o where o.id = order_id and o.user_id = auth.uid())
);
revoke all on public.lite_tiers, public.lite_tickets from anon, authenticated;
grant select on public.lite_tiers to anon, authenticated;
grant select on public.lite_tickets to authenticated;
commit;
notify pgrst, 'reload schema';
