-- Fixed IDs make seeding repeatable without replenishing sold tickets.
insert into public.lite_events(id,title,description,city,venue,starts_at,price_paise,capacity,available,image,published)
select
  ('00000000-0000-4000-8000-00000000000' || n)::uuid,
  title,
  'An evening of live music, friends, and an unforgettable atmosphere. General admission includes entry.',
  city,
  venue,
  date_trunc('day', now()) + ((14 + n * 3) || ' days')::interval + interval '13 hours',
  price, 100, 100, n, true
from (values
  (1,'Indie After Hours','Bengaluru','Fictional Open Air Arena',89900),
  (2,'Neon Nights Festival','Mumbai','Fictional Harbour Stage',149900),
  (3,'Jazz Under the Stars','Delhi','Fictional Garden Amphitheatre',119900),
  (4,'Electric Skies','Hyderabad','Fictional City Music Ground',99900),
  (5,'Sunset Acoustic Club','Chennai','Fictional Beachside Pavilion',69900),
  (6,'Weekend Soundwaves','Pune','Fictional Riverside Arena',129900)
) as seed(n,title,city,venue,price)
on conflict (id) do nothing;
