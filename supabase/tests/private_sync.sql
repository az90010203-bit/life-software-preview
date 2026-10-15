-- Self-contained PostgreSQL assertions. Run in a dedicated test database as postgres.
-- All fixtures and effects roll back; no pgTAP extension is required.
begin;

create or replace function pg_temp.check_true(value boolean, label text)
returns void language plpgsql as $$ begin if value is distinct from true then raise exception 'FAIL: %', label; end if; end $$;
create or replace function pg_temp.note_data(value text)
returns jsonb language sql as $$ select jsonb_build_object('text', value, 'createdAt', '2026-10-15T00:00:00Z', 'updatedAt', '2026-10-15T00:00:00Z'); $$;
create or replace function pg_temp.task_data(value text, day text default '2026-10-15')
returns jsonb language sql as $$ select jsonb_build_object('title', value, 'date', day, 'completed', false, 'createdAt', '2026-10-15T00:00:00Z', 'updatedAt', '2026-10-15T00:00:00Z'); $$;
create or replace function pg_temp.change(entity_kind text, entity_id text, before_data jsonb, after_data jsonb)
returns jsonb language sql as $$ select jsonb_build_object('kind', entity_kind, 'id', entity_id, 'base', before_data, 'next', after_data); $$;
create or replace function pg_temp.operation(operation_id text, changes jsonb)
returns jsonb language sql as $$ select jsonb_build_object('id', operation_id, 'changes', changes); $$;

insert into auth.users(id, email) values ('11111111-1111-4111-8111-111111111111', 'sql-test-owner@example.invalid') on conflict (id) do nothing;
delete from public.app_owners;
insert into public.app_owners(user_id) values ('11111111-1111-4111-8111-111111111111');
delete from public.sync_entities where owner = '11111111-1111-4111-8111-111111111111';
delete from public.sync_state where owner = '11111111-1111-4111-8111-111111111111';
delete from life_private.sync_receipts where owner = '11111111-1111-4111-8111-111111111111';
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);

do $$
declare
  result jsonb;
  repeated jsonb;
  base jsonb := pg_temp.note_data('原文');
  next_data jsonb;
  operation jsonb;
  before_cursor bigint;
  invalid boolean;
begin
  result := public.pull_changes(0);
  perform pg_temp.check_true(result = '{"cursor":0,"entities":[]}'::jsonb, 'empty authorized pull');
  operation := pg_temp.operation('create-note', jsonb_build_array(pg_temp.change('notes', 'n1', null, base)));
  result := public.apply_operation(operation);
  perform pg_temp.check_true(result ->> 'status' = 'applied' and (result ->> 'cursor')::bigint = 1, 'create commits cursor one');
  perform pg_temp.check_true(result -> 'entities' -> 0 ->> 'version' = '1', 'server assigns initial version');
  repeated := public.apply_operation(operation);
  perform pg_temp.check_true(repeated = result, 'receipt gives byte-equivalent JSON on retry');
  perform pg_temp.check_true((public.pull_changes(1) -> 'entities') = '[]'::jsonb, 'idempotent retry does not advance cursor');
  invalid := false;
  begin perform public.apply_operation(jsonb_set(operation, '{changes,0,next,text}', '"different"')); exception when invalid_parameter_value then invalid := true; end;
  perform pg_temp.check_true(invalid, 'reused operation id with changed payload rejected');

  -- A changed server field merges with a different locally changed field.
  result := public.apply_operation(pg_temp.operation('remote-text', jsonb_build_array(pg_temp.change('notes', 'n1', base, base || '{"text":"远端改文","updatedAt":"2026-10-15T01:00:00Z"}'))));
  result := public.apply_operation(pg_temp.operation('local-createdAt', jsonb_build_array(pg_temp.change('notes', 'n1', base, base || '{"createdAt":"2026-10-14T00:00:00Z","updatedAt":"2026-10-15T02:00:00Z"}'))));
  perform pg_temp.check_true(result ->> 'status' = 'applied' and result -> 'entities' -> 0 -> 'data' ->> 'text' = '远端改文', 'different fields merge');
  perform pg_temp.check_true(result -> 'entities' -> 0 -> 'data' ->> 'createdAt' = '2026-10-14T00:00:00Z' and result -> 'entities' -> 0 -> 'data' ->> 'updatedAt' = '2026-10-15T02:00:00Z', 'updatedAt merges without conflict');
  before_cursor := (result ->> 'cursor')::bigint;
  operation := pg_temp.operation('same-field-conflict', jsonb_build_array(
    pg_temp.change('notes', 'n1', base, base || '{"text":"本地改文"}'),
    pg_temp.change('notes', 'must-not-create', null, pg_temp.note_data('不能部分保存'))
  ));
  result := public.apply_operation(operation);
  perform pg_temp.check_true(result ->> 'status' = 'conflict' and (result ->> 'cursor')::bigint = before_cursor, 'same field conflict keeps cursor unchanged');
  perform pg_temp.check_true(jsonb_array_length(result -> 'entities') = 2, 'conflict returns every touched entity');
  perform pg_temp.check_true(result -> 'entities' -> 1 = '{"kind":"notes","id":"must-not-create","version":0,"data":null}'::jsonb, 'missing conflict entity has null data and version zero');
  perform pg_temp.check_true(not exists(select 1 from public.sync_entities where id = 'must-not-create'), 'conflicting batch writes nothing');
  perform pg_temp.check_true(public.apply_operation(operation) = result, 'conflicts have durable idempotent receipts');

  -- Missing optional keys are edits too; deleting time must not reintroduce it.
  base := pg_temp.task_data('安排') || '{"time":"08:30","details":"保留详情"}';
  perform public.apply_operation(pg_temp.operation('task-timed', jsonb_build_array(pg_temp.change('tasks', 't1', null, base))));
  perform public.apply_operation(pg_temp.operation('task-title', jsonb_build_array(pg_temp.change('tasks', 't1', base, base || '{"title":"新标题"}'))));
  result := public.apply_operation(pg_temp.operation('remove-optional-key', jsonb_build_array(pg_temp.change('tasks', 't1', base, base - 'time'))));
  perform pg_temp.check_true(result ->> 'status' = 'applied' and not (result -> 'entities' -> 0 -> 'data' ? 'time') and result -> 'entities' -> 0 -> 'data' ->> 'title' = '新标题', 'field deletion merges while retaining other server edits');

  -- Task/focus changes validate against the final batch, even when focus appears first.
  result := public.apply_operation(pg_temp.operation('focus-create-atomic', jsonb_build_array(
    pg_temp.change('focus', '2026-10-15', null, '{"ids":["t1","t2","t3"]}'),
    pg_temp.change('tasks', 't2', null, pg_temp.task_data('第二件')),
    pg_temp.change('tasks', 't3', null, pg_temp.task_data('第三件'))
  )));
  perform pg_temp.check_true(result ->> 'status' = 'applied' and jsonb_array_length(result -> 'entities') = 3, 'focus can reference tasks created in the same atomic batch');
  perform pg_temp.check_true((select count(distinct cursor) = 1 from public.sync_entities where id in ('2026-10-15', 't2', 't3')), 'all changed batch entities share one cursor');
  before_cursor := (result ->> 'cursor')::bigint;
  invalid := false;
  begin perform public.apply_operation(pg_temp.operation('four-focus', jsonb_build_array(pg_temp.change('focus', '2026-10-15', '{"ids":["t1","t2","t3"]}', '{"ids":["t1","t2","t3","t4"]}')))); exception when invalid_parameter_value then invalid := true; end;
  perform pg_temp.check_true(invalid, 'four priorities rejected');
  invalid := false;
  begin perform public.apply_operation(pg_temp.operation('duplicate-focus', jsonb_build_array(pg_temp.change('focus', '2026-10-16', null, '{"ids":["t1","t1"]}')))); exception when invalid_parameter_value then invalid := true; end;
  perform pg_temp.check_true(invalid, 'duplicate priority rejected');
  result := public.apply_operation(pg_temp.operation('missing-task', jsonb_build_array(pg_temp.change('focus', '2026-10-16', null, '{"ids":["missing"]}'))));
  perform pg_temp.check_true(result ->> 'status' = 'conflict' and (result ->> 'cursor')::bigint = before_cursor, 'unknown task reference conflicts without a write');

  -- Deleted task cannot remain in a newly submitted focus; removing focus in the
  -- same operation makes deletion valid. Soft deletion keeps recoverable content.
  base := pg_temp.task_data('第二件');
  next_data := base || '{"deletedAt":"2026-10-15T03:00:00Z"}';
  result := public.apply_operation(pg_temp.operation('delete-with-invalid-focus', jsonb_build_array(
    pg_temp.change('tasks', 't2', base, next_data),
    pg_temp.change('focus', '2026-10-16', null, '{"ids":["t2"]}')
  )));
  perform pg_temp.check_true(result ->> 'status' = 'conflict' and not (result -> 'entities' -> 0 -> 'data' ? 'deletedAt'), 'bad final focus rolls back task deletion too');
  result := public.apply_operation(pg_temp.operation('soft-delete-atomic', jsonb_build_array(
    pg_temp.change('tasks', 't2', base, next_data),
    pg_temp.change('focus', '2026-10-15', '{"ids":["t1","t2","t3"]}', '{"ids":["t1","t3"]}')
  )));
  perform pg_temp.check_true(result ->> 'status' = 'applied', 'delete and focus removal commit atomically');
  result := public.apply_operation(pg_temp.operation('stale-edit-deleted', jsonb_build_array(pg_temp.change('tasks', 't2', base, base || '{"title":"陈旧编辑"}'))));
  perform pg_temp.check_true(result ->> 'status' = 'conflict', 'editing a remotely soft-deleted entity requires conflict resolution');
  result := public.apply_operation(pg_temp.operation('restore-task', jsonb_build_array(pg_temp.change('tasks', 't2', next_data, next_data - 'deletedAt'))));
  perform pg_temp.check_true(result ->> 'status' = 'applied' and not (result -> 'entities' -> 0 -> 'data' ? 'deletedAt'), 'explicit restore removes deletedAt');

  -- Historical focus may keep a task after it is carried to a later date.
  result := public.apply_operation(pg_temp.operation('carry-task', jsonb_build_array(
    pg_temp.change('tasks', 't3', pg_temp.task_data('第三件'), pg_temp.task_data('第三件', '2026-10-17')),
    pg_temp.change('focus', '2026-10-17', null, '{"ids":["t3"]}')
  )));
  perform pg_temp.check_true(result ->> 'status' = 'applied', 'reschedule plus new focus is atomic');
  perform pg_temp.check_true((select data -> 'ids' ? 't3' from public.sync_entities where kind = 'focus' and id = '2026-10-15'), 'reschedule retains historical focus');
  result := public.apply_operation(pg_temp.operation('historical-reference', jsonb_build_array(pg_temp.change('focus', '2026-10-15', '{"ids":["t1","t3"]}', '{"ids":["t3","t1"]}'))));
  perform pg_temp.check_true(result ->> 'status' = 'applied', 'historical reference does not require equal task date');

  base := pg_temp.note_data('永久删除前');
  perform public.apply_operation(pg_temp.operation('hard-create', jsonb_build_array(pg_temp.change('notes', 'hard', null, base))));
  result := public.apply_operation(pg_temp.operation('hard-delete', jsonb_build_array(pg_temp.change('notes', 'hard', base, null))));
  perform pg_temp.check_true(result -> 'entities' -> 0 -> 'data' = 'null'::jsonb and (result -> 'entities' -> 0 ->> 'version')::int = 2, 'hard tombstone retained with server version');
  result := public.apply_operation(pg_temp.operation('hard-stale-edit', jsonb_build_array(pg_temp.change('notes', 'hard', base, base || '{"text":"旧设备修改"}'))));
  perform pg_temp.check_true(result ->> 'status' = 'conflict', 'hard tombstone rejects stale editing');
  result := public.apply_operation(pg_temp.operation('hard-stale-create', jsonb_build_array(pg_temp.change('notes', 'hard', null, base))));
  perform pg_temp.check_true(result ->> 'status' = 'conflict', 'hard tombstone also rejects stale creation with null base');

  before_cursor := (public.pull_changes(0) ->> 'cursor')::bigint;
  result := public.apply_operation(pg_temp.operation('day-note', jsonb_build_array(pg_temp.change('dayNotes', '2026-10-15', null, '{"text":"当天备注"}'))));
  repeated := public.pull_changes(before_cursor);
  perform pg_temp.check_true(repeated ->> 'cursor' = result ->> 'cursor' and jsonb_array_length(repeated -> 'entities') = 1, 'incremental cursor returns committed tail only');
  perform pg_temp.check_true(public.pull_changes((result ->> 'cursor')::bigint) -> 'entities' = '[]'::jsonb, 'pull reaches an exact empty boundary');
  invalid := false;
  begin perform public.pull_changes(-1); exception when invalid_parameter_value then invalid := true; end;
  perform pg_temp.check_true(invalid, 'negative cursor rejected');
  invalid := false;
  begin perform public.pull_changes(999999); exception when invalid_parameter_value then invalid := true; end;
  perform pg_temp.check_true(invalid, 'future cursor rejected');

  -- Payload validation is server-side; metadata cannot choose a server version.
  invalid := false;
  begin perform public.apply_operation(pg_temp.operation('invalid-date', jsonb_build_array(pg_temp.change('tasks', 'bad-date', null, pg_temp.task_data('无效', '2026-02-30'))))); exception when invalid_parameter_value then invalid := true; end;
  perform pg_temp.check_true(invalid, 'impossible task date rejected');
  invalid := false;
  begin perform public.apply_operation(pg_temp.operation('invalid-time', jsonb_build_array(pg_temp.change('tasks', 'bad-time', null, pg_temp.task_data('无效') || '{"time":"25:00"}')))); exception when invalid_parameter_value then invalid := true; end;
  perform pg_temp.check_true(invalid, 'invalid task time rejected');
  invalid := false;
  begin perform public.apply_operation(pg_temp.operation('invalid-title', jsonb_build_array(pg_temp.change('tasks', 'bad-title', null, pg_temp.task_data('  '))))); exception when invalid_parameter_value then invalid := true; end;
  perform pg_temp.check_true(invalid, 'empty title rejected');
  invalid := false;
  begin perform public.apply_operation(pg_temp.operation('invalid-note', jsonb_build_array(pg_temp.change('notes', 'bad-note', null, '{"text":3}')))); exception when invalid_parameter_value then invalid := true; end;
  perform pg_temp.check_true(invalid, 'non-text note rejected');
  invalid := false;
  begin perform public.apply_operation(pg_temp.operation('forged-version', jsonb_build_array(pg_temp.change('notes', 'bad-version', null, pg_temp.note_data('无效') || '{"revision":999,"version":999}')))); exception when invalid_parameter_value then invalid := true; end;
  perform pg_temp.check_true(invalid, 'local revision and forged server version rejected');
end;
$$;

reset role;
select 'private_sync.sql: all assertions passed' as result;
rollback;
