create role anon nologin;
create role authenticated nologin;
create role authenticator login password 'local-lite-test-password' noinherit;
grant anon, authenticated to authenticator;
create schema if not exists auth;
grant usage on schema public, auth to anon, authenticated;
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
$$;

