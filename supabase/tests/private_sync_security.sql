-- Permission tests for a dedicated database; all auth fixtures roll back.
begin;
create or replace function pg_temp.check_true(value boolean, label text)
returns void language plpgsql as $$ begin if value is distinct from true then raise exception 'FAIL: %', label; end if; end $$;
insert into auth.users(id, email) values
  ('11111111-1111-4111-8111-111111111111', 'sql-test-owner@example.invalid'),
  ('22222222-2222-4222-8222-222222222222', 'sql-test-outsider@example.invalid') on conflict (id) do nothing;
delete from public.app_owners;
insert into public.app_owners(user_id) values ('11111111-1111-4111-8111-111111111111');
delete from public.sync_entities where owner in ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222');
insert into public.sync_entities(owner, kind, id, version, cursor, data) values
  ('11111111-1111-4111-8111-111111111111', 'notes', 'owner-note', 1, 1, '{"text":"private owner"}'),
  ('22222222-2222-4222-8222-222222222222', 'notes', 'outsider-note', 1, 1, '{"text":"must still be denied"}');

do $$ declare denied boolean := false; begin
  begin insert into public.app_owners(user_id) values ('22222222-2222-4222-8222-222222222222'); exception when unique_violation then denied := true; end;
  perform pg_temp.check_true(denied, 'database cannot provision a second private owner');
end $$;

set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{}', true);
do $$ declare denied boolean; begin
  denied := false; begin perform public.pull_changes(0); exception when insufficient_privilege then denied := true; end;
  perform pg_temp.check_true(denied, 'anonymous RPC pull denied');
  denied := false; begin perform public.apply_operation('{"id":"anon","changes":[]}'); exception when insufficient_privilege then denied := true; end;
  perform pg_temp.check_true(denied, 'anonymous RPC mutation denied');
  denied := false; begin perform * from public.sync_entities; exception when insufficient_privilege then denied := true; end;
  perform pg_temp.check_true(denied, 'anonymous direct reads denied');
end $$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
do $$ declare denied boolean; begin
  perform pg_temp.check_true((select count(*) = 0 from public.sync_entities), 'outsider sees neither owner data nor its unapproved own rows');
  perform pg_temp.check_true((select count(*) = 0 from public.app_owners), 'outsider cannot inspect owner whitelist');
  denied := false; begin perform public.pull_changes(0); exception when insufficient_privilege then denied := true; end;
  perform pg_temp.check_true(denied, 'authenticated non-owner cannot pull');
  denied := false; begin perform public.apply_operation('{"id":"outsider","changes":[]}'); exception when insufficient_privilege then denied := true; end;
  perform pg_temp.check_true(denied, 'authenticated non-owner cannot mutate');
end $$;

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
do $$ declare denied boolean; begin
  perform pg_temp.check_true((select count(*) = 1 and bool_and(owner = auth.uid()) from public.sync_entities), 'owner RLS returns own data only');
  denied := false; begin insert into public.sync_entities(owner,kind,id,version,cursor,data) values(auth.uid(),'notes','bypass',1,1,'{"text":"blocked"}'); exception when insufficient_privilege then denied := true; end;
  perform pg_temp.check_true(denied, 'owner cannot insert directly');
  denied := false; begin update public.sync_entities set data = '{"text":"blocked"}'; exception when insufficient_privilege then denied := true; end;
  perform pg_temp.check_true(denied, 'owner cannot update directly');
  denied := false; begin delete from public.sync_entities; exception when insufficient_privilege then denied := true; end;
  perform pg_temp.check_true(denied, 'owner cannot delete directly');
  denied := false; begin delete from public.app_owners; exception when insufficient_privilege then denied := true; end;
  perform pg_temp.check_true(denied, 'owner cannot change its own whitelist entry');
  denied := false; begin perform * from life_private.sync_receipts; exception when insufficient_privilege then denied := true; end;
  perform pg_temp.check_true(denied, 'receipts cannot be read directly');
  denied := false; begin perform life_private.current_entities(auth.uid(), '[]'); exception when insufficient_privilege then denied := true; end;
  perform pg_temp.check_true(denied, 'internal arbitrary-account reader is not callable');
  denied := false; begin perform public.pull_changes(after_cursor => 0, expected_owner => '22222222-2222-4222-8222-222222222222'); exception when insufficient_privilege then denied := true; end;
  perform pg_temp.check_true(denied, 'authorized user cannot pull for a mismatching expected owner');
  denied := false; begin perform public.apply_operation('{"id":"wrong-operation-owner","owner":"22222222-2222-4222-8222-222222222222","changes":[{"kind":"notes","id":"owner-leak","base":null,"next":{"text":"must not write"}}]}'); exception when insufficient_privilege then denied := true; end;
  perform pg_temp.check_true(denied, 'operation owner is bound to the authenticated subject');
  denied := false; begin perform public.apply_operation('{"id":"invalid-operation-owner","owner":"not-a-uuid","changes":[{"kind":"notes","id":"owner-leak","base":null,"next":{"text":"must not write"}}]}'); exception when insufficient_privilege then denied := true; end;
  perform pg_temp.check_true(denied, 'malformed owner is denied rather than ignored');
  denied := false; begin perform public.apply_operation('{"id":"null-operation-owner","owner":null,"changes":[{"kind":"notes","id":"owner-leak","base":null,"next":{"text":"must not write"}}]}'); exception when insufficient_privilege then denied := true; end;
  perform pg_temp.check_true(denied, 'provided null owner is not treated as omitted');
  perform pg_temp.check_true(not exists(select 1 from public.sync_entities where id = 'owner-leak'), 'rejected owner bindings never write an entity');
end $$;

-- A session may become B after the client captured A. Even if an administrator
-- has since provisioned B, requests still explicitly bound to A must fail.
reset role;
delete from public.app_owners;
insert into public.app_owners(user_id) values ('22222222-2222-4222-8222-222222222222');
set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
do $$ declare denied boolean; begin
  denied := false; begin perform public.pull_changes(0, '11111111-1111-4111-8111-111111111111'); exception when insufficient_privilege then denied := true; end;
  perform pg_temp.check_true(denied, 'switched-to-B session cannot read an A-bound request');
  denied := false; begin perform public.apply_operation('{"id":"session-switched-operation","owner":"11111111-1111-4111-8111-111111111111","changes":[{"kind":"notes","id":"a-data-in-b","base":null,"next":{"text":"private A content"}}]}'); exception when insufficient_privilege then denied := true; end;
  perform pg_temp.check_true(denied, 'switched-to-B session cannot write A queued data into B');
  perform pg_temp.check_true(not exists(select 1 from public.sync_entities where id = 'a-data-in-b'), 'session switch leaves the destination account unchanged');
end $$;

-- Even a signed-in database role with no valid subject is denied by RPC itself.
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{}', true);
do $$ declare denied boolean := false; begin
  begin perform public.pull_changes(0); exception when insufficient_privilege then denied := true; end;
  perform pg_temp.check_true(denied, 'authenticated role without a subject is not an owner');
end $$;

reset role;
select 'private_sync_security.sql: all assertions passed' as result;
rollback;
