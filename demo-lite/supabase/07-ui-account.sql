create or replace function public.tc_check_in(p_event_id uuid,p_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare event public.lite_events; ticket public.lite_tickets;
begin
  select * into event from public.lite_events where id=p_event_id for update;
  if not found or event.owner_id is distinct from auth.uid() then raise exception 'Only the event owner can check in tickets'; end if;
  if not event.published or event.lifecycle <> 'published' then raise exception 'This event is not accepting admission'; end if;
  select t.* into ticket from public.lite_tickets t join public.lite_orders o on o.id=t.order_id
    where t.event_id=event.id and t.code=p_code and o.status='paid' for update of t;
  if not found or ticket.status <> 'valid' then raise exception 'Ticket is invalid or already used'; end if;
  update public.lite_tickets set status='checked_in',checked_at=now() where id=ticket.id;
  return ticket.id;
end $$;

create or replace function public.tc_attendees(p_event_id uuid)
returns table(id uuid,name text,status text,order_status text)
language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.lite_events e where e.id=p_event_id and e.owner_id=auth.uid()) then raise exception 'Event not found'; end if;
  return query select t.id,coalesce(u.raw_user_meta_data->>'display_name','Attendee'),t.status,o.status
    from public.lite_tickets t join public.lite_orders o on o.id=t.order_id join auth.users u on u.id=o.user_id
    where t.event_id=p_event_id order by t.created_at;
end $$;

create or replace function public.tc_summary(p_event_id uuid)
returns table(status text,currency text,orders bigint,total text)
language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.lite_events e where e.id=p_event_id and e.owner_id=auth.uid()) then raise exception 'Event not found'; end if;
  return query select o.status,'INR',count(*),sum(o.total_paise)::text from public.lite_orders o
    where o.event_id=p_event_id group by o.status;
end $$;
revoke all on function public.tc_check_in(uuid,text) from public, anon;
revoke all on function public.tc_attendees(uuid) from public, anon;
revoke all on function public.tc_summary(uuid) from public, anon;
grant execute on function public.tc_check_in(uuid,text) to authenticated;
grant execute on function public.tc_attendees(uuid) to authenticated;
grant execute on function public.tc_summary(uuid) to authenticated;

-- Free Supabase Storage holds processed profile photos in each user's own folder.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('profile-photos','profile-photos',true,524288,array['image/webp']) on conflict(id) do nothing;
drop policy if exists tc_photo_insert on storage.objects;
create policy tc_photo_insert on storage.objects for insert to authenticated with check (
  bucket_id='profile-photos' and (storage.foldername(name))[1]=auth.uid()::text
);
drop policy if exists tc_photo_delete on storage.objects;
create policy tc_photo_delete on storage.objects for delete to authenticated using (
  bucket_id='profile-photos' and (storage.foldername(name))[1]=auth.uid()::text
);
drop policy if exists tc_photo_owner_read on storage.objects;
create policy tc_photo_owner_read on storage.objects for select to authenticated using (
  bucket_id='profile-photos' and (storage.foldername(name))[1]=auth.uid()::text
);
notify pgrst, 'reload schema';
