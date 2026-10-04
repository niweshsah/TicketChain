-- Run these files in order in a NEW Supabase Free project's SQL Editor.
-- Re-running them preserves existing events, bookings, and inventory.
create table if not exists public.lite_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete restrict,
  title text not null check (char_length(trim(title)) between 3 and 100),
  description text not null check (char_length(trim(description)) between 20 and 2000),
  city text not null check (city in ('Bengaluru','Mumbai','Delhi','Hyderabad','Chennai','Pune','Kolkata','Ahmedabad','Jaipur','Kochi')),
  venue text not null check (char_length(trim(venue)) between 3 and 200),
  starts_at timestamptz not null,
  price_paise integer not null check (price_paise between 0 and 10000000),
  capacity integer not null check (capacity between 1 and 5000),
  available integer not null check (available between 0 and capacity),
  image integer not null default 1 check (image between 1 and 6),
  published boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.lite_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  event_id uuid not null references public.lite_events(id) on delete restrict,
  request_id uuid not null,
  quantity integer not null check (quantity between 1 and 10),
  total_paise integer not null check (total_paise >= 0),
  status text not null default 'paid' check (status in ('paid','refunded')),
  created_at timestamptz not null default now(),
  unique (user_id, request_id)
);

create index if not exists lite_events_discovery on public.lite_events (published, starts_at);
create index if not exists lite_orders_user on public.lite_orders (user_id, created_at);
alter table public.lite_events enable row level security;
alter table public.lite_orders enable row level security;

drop policy if exists lite_events_read on public.lite_events;
create policy lite_events_read on public.lite_events for select to anon, authenticated
  using (published or owner_id = (select auth.uid()));
drop policy if exists lite_orders_read on public.lite_orders;
create policy lite_orders_read on public.lite_orders for select to authenticated
  using (user_id = (select auth.uid()));

-- Browsers can read permitted rows. All writes use the guarded functions below.
revoke all on public.lite_events, public.lite_orders from anon, authenticated;
grant select on public.lite_events to anon, authenticated;
grant select on public.lite_orders to authenticated;

create or replace function public.lite_create_event(
  p_title text, p_description text, p_city text, p_venue text,
  p_starts_at timestamptz, p_price_paise integer, p_capacity integer, p_image integer
) returns uuid language plpgsql security definer set search_path = '' as $$
declare result uuid;
begin
  if auth.uid() is null then raise exception 'Please sign in'; end if;
  if p_starts_at <= now() then raise exception 'Choose a future event date'; end if;
  insert into public.lite_events(owner_id,title,description,city,venue,starts_at,price_paise,capacity,available,image)
  values(auth.uid(),trim(p_title),trim(p_description),p_city,trim(p_venue),p_starts_at,p_price_paise,p_capacity,p_capacity,p_image)
  returning id into result;
  return result;
end $$;

create or replace function public.lite_publish_event(p_event_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Please sign in'; end if;
  update public.lite_events set published = true
    where id = p_event_id and owner_id = auth.uid() and starts_at > now();
  if not found then raise exception 'Only the owner can publish a future event'; end if;
end $$;

revoke all on function public.lite_create_event(text,text,text,text,timestamptz,integer,integer,integer) from public, anon;
revoke all on function public.lite_publish_event(uuid) from public, anon;
grant execute on function public.lite_create_event(text,text,text,text,timestamptz,integer,integer,integer) to authenticated;
grant execute on function public.lite_publish_event(uuid) to authenticated;
