-- Private, single-account sync. Run as the database administrator / postgres.
-- Re-running replaces functions and policies without deleting user data.
begin;

create schema if not exists life_private;
revoke all on schema life_private from public, anon, authenticated;
grant usage on schema life_private to authenticated;

create table if not exists public.app_owners (
  user_id uuid primary key references auth.users(id) on delete cascade
);
-- This application has exactly zero or one provisioned owner, never open enrollment.
create unique index if not exists app_owners_single_account on public.app_owners ((true));

create table if not exists public.sync_state (
  owner uuid primary key references auth.users(id) on delete cascade,
  cursor bigint not null default 0 check (cursor >= 0)
);
create table if not exists public.sync_entities (
  owner uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('notes', 'tasks', 'focus', 'dayNotes')),
  id text not null check (length(id) between 1 and 200),
  version bigint not null check (version > 0),
  cursor bigint not null check (cursor > 0),
  data jsonb,
  primary key (owner, kind, id),
  constraint sync_entities_object_or_tombstone check (data is null or jsonb_typeof(data) = 'object')
);
create index if not exists sync_entities_owner_cursor on public.sync_entities(owner, cursor);
create table if not exists life_private.sync_receipts (
  owner uuid not null references auth.users(id) on delete cascade,
  operation_id text not null,
  request jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (owner, operation_id)
);

alter table public.app_owners enable row level security;
alter table public.sync_state enable row level security;
alter table public.sync_entities enable row level security;
alter table life_private.sync_receipts enable row level security;

revoke all on table public.app_owners, public.sync_state, public.sync_entities from public, anon, authenticated;
revoke all on table life_private.sync_receipts from public, anon, authenticated;
grant select on table public.app_owners, public.sync_state, public.sync_entities to authenticated;

drop policy if exists app_owner_self_read on public.app_owners;
create policy app_owner_self_read on public.app_owners for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists private_sync_owner_read on public.sync_entities;
create policy private_sync_owner_read on public.sync_entities for select to authenticated
  using (owner = (select auth.uid()) and exists (
    select 1 from public.app_owners allowed where allowed.user_id = (select auth.uid())
  ));
drop policy if exists private_sync_state_read on public.sync_state;
create policy private_sync_state_read on public.sync_state for select to authenticated
  using (owner = (select auth.uid()) and exists (
    select 1 from public.app_owners allowed where allowed.user_id = (select auth.uid())
  ));

create or replace function life_private.valid_day(value text)
returns boolean language plpgsql immutable set search_path = '' as $$
begin
  if value is null or value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or left(value, 4) = '0000' then return false; end if;
  return to_char(value::date, 'YYYY-MM-DD') = value;
exception when others then return false;
end;
$$;

create or replace function life_private.validate_entity(entity_kind text, entity_id text, payload jsonb)
returns void language plpgsql immutable set search_path = '' as $$
declare
  allowed text[];
  field text;
begin
  if entity_kind not in ('notes', 'tasks', 'focus', 'dayNotes') or entity_id is null or length(entity_id) not between 1 and 200 then
    raise exception using errcode = '22023', message = '实体类型或标识无效。';
  end if;
  if entity_kind in ('focus', 'dayNotes') and not life_private.valid_day(entity_id) then
    raise exception using errcode = '22023', message = '记录日期无效。';
  end if;
  if payload is null then return; end if;
  if jsonb_typeof(payload) <> 'object' then
    raise exception using errcode = '22023', message = '实体内容必须是对象或删除标记。';
  end if;
  allowed := case entity_kind
    when 'notes' then array['text', 'createdAt', 'updatedAt', 'deletedAt']
    when 'tasks' then array['title', 'date', 'time', 'details', 'sourceNoteId', 'completed', 'createdAt', 'updatedAt', 'deletedAt']
    when 'focus' then array['ids']
    else array['text'] end;
  for field in select jsonb_object_keys(payload) loop
    if not (field = any(allowed)) then
      raise exception using errcode = '22023', message = '实体包含不支持的字段：' || field;
    end if;
  end loop;
  if entity_kind in ('notes', 'dayNotes') then
    if jsonb_typeof(payload -> 'text') is distinct from 'string' or (entity_kind = 'notes' and btrim(payload ->> 'text') = '') then
      raise exception using errcode = '22023', message = '片段需要有效的文字内容。';
    end if;
  end if;
  if entity_kind = 'tasks' then
    if jsonb_typeof(payload -> 'title') is distinct from 'string' or btrim(payload ->> 'title') = '' then
      raise exception using errcode = '22023', message = '事项标题不能为空。';
    end if;
    if jsonb_typeof(payload -> 'date') is distinct from 'string' or not life_private.valid_day(payload ->> 'date') then
      raise exception using errcode = '22023', message = '事项日期无效。';
    end if;
    if jsonb_typeof(payload -> 'completed') is distinct from 'boolean' then
      raise exception using errcode = '22023', message = '事项完成状态无效。';
    end if;
    if payload ? 'time' and (jsonb_typeof(payload -> 'time') <> 'string' or (payload ->> 'time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then
      raise exception using errcode = '22023', message = '事项时间无效。';
    end if;
    foreach field in array array['details', 'sourceNoteId'] loop
      if payload ? field and jsonb_typeof(payload -> field) <> 'string' then
        raise exception using errcode = '22023', message = '事项详情字段必须是文字。';
      end if;
    end loop;
  end if;
  if entity_kind in ('notes', 'tasks') then
    foreach field in array array['createdAt', 'updatedAt', 'deletedAt'] loop
      if payload ? field then
        if jsonb_typeof(payload -> field) <> 'string' then
          raise exception using errcode = '22023', message = '记录时间必须是文字。';
        end if;
        begin
          perform (payload ->> field)::timestamptz;
        exception when others then
          raise exception using errcode = '22023', message = '记录时间无效。';
        end;
      end if;
    end loop;
  end if;
  if entity_kind = 'focus' then
    if jsonb_typeof(payload -> 'ids') is distinct from 'array' then
      raise exception using errcode = '22023', message = '重点列表无效。';
    end if;
    if jsonb_array_length(payload -> 'ids') > 3 or exists (
      select 1 from jsonb_array_elements(payload -> 'ids') element
      where jsonb_typeof(element) <> 'string' or length(element #>> '{}') not between 1 and 200
    ) or (select count(*) from jsonb_array_elements(payload -> 'ids')) <> (select count(distinct element) from jsonb_array_elements(payload -> 'ids') element) then
      raise exception using errcode = '22023', message = '每天至多三件重点，且不能重复。';
    end if;
  end if;
end;
$$;

-- Top-level three-way merge; missing keys and JSON null are deliberately distinct.
-- Only business changes participate in conflicts. updatedAt still merges normally.
create or replace function life_private.merge_entity(entity_kind text, base_data jsonb, next_data jsonb, remote_data jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  merged jsonb;
  field text;
  restore boolean := base_data ? 'deletedAt' and not (next_data ? 'deletedAt');
begin
  if next_data is null then
    if remote_data is null then return null; end if;
    if base_data is null or (remote_data - 'updatedAt') is distinct from (base_data - 'updatedAt') then
      raise exception using errcode = 'P0001', message = '远端内容已有修改，请保留本地版本后处理删除冲突。';
    end if;
    return null;
  end if;
  if remote_data is null and base_data is not null then
    if (next_data - 'updatedAt') is not distinct from (base_data - 'updatedAt') then return null; end if;
    raise exception using errcode = 'P0001', message = '这份内容已在其他设备删除，本地修改仍然保留。';
  end if;
  if entity_kind in ('notes', 'tasks') and remote_data is not null then
    if (remote_data -> 'deletedAt') is distinct from (base_data -> 'deletedAt') and not coalesce(restore, false) then
      raise exception using errcode = 'P0001', message = '这份内容的删除状态已改变，请先查看最新版本。';
    end if;
    if next_data ? 'deletedAt' and (next_data -> 'deletedAt') is distinct from (base_data -> 'deletedAt')
       and (remote_data - 'updatedAt' - 'deletedAt') is distinct from (base_data - 'updatedAt' - 'deletedAt') then
      raise exception using errcode = 'P0001', message = '远端内容已有修改，请先查看最新版本再删除。';
    end if;
  end if;
  merged := coalesce(remote_data, '{}'::jsonb);
  for field in select key from (
    select jsonb_object_keys(coalesce(base_data, '{}'::jsonb)) as key
    union select jsonb_object_keys(next_data) as key
  ) keys loop
    if (base_data -> field) is not distinct from (next_data -> field) then continue; end if;
    if field <> 'updatedAt' and (remote_data -> field) is distinct from (base_data -> field) and (remote_data -> field) is distinct from (next_data -> field) then
      raise exception using errcode = 'P0001', message = '同一字段已在其他设备修改，本地版本仍然保留。';
    end if;
    if next_data ? field then merged := jsonb_set(merged, array[field], next_data -> field, true);
    else merged := merged - field; end if;
  end loop;
  return merged;
end;
$$;

create or replace function life_private.current_entities(account uuid, changes jsonb)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'kind', change.value ->> 'kind', 'id', change.value ->> 'id',
    'version', coalesce(entity.version, 0), 'data', entity.data
  ) order by change.ordinality), '[]'::jsonb)
  from jsonb_array_elements(changes) with ordinality change(value, ordinality)
  left join public.sync_entities entity on entity.owner = account and entity.kind = change.value ->> 'kind' and entity.id = change.value ->> 'id';
$$;

-- Private definer functions perform the only writes. Exposed wrappers below are invokers.
create or replace function life_private.apply_operation(operation jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  account uuid := auth.uid();
  v_operation_id text;
  current_cursor bigint;
  receipt life_private.sync_receipts%rowtype;
  change jsonb;
  candidate jsonb;
  candidates jsonb := '[]'::jsonb;
  remote_data jsonb;
  remote_exists boolean;
  next_data jsonb;
  base_data jsonb;
  merged jsonb;
  conflict_message text;
  task_id text;
  task_data jsonb;
  changed boolean := false;
  response jsonb;
begin
  if account is null or not exists (select 1 from public.app_owners where user_id = account) then
    raise exception using errcode = '42501', message = '仅预置的私人账户可以同步。';
  end if;
  if jsonb_typeof(operation) is distinct from 'object' or jsonb_typeof(operation -> 'id') is distinct from 'string'
     or length(operation ->> 'id') not between 1 and 200 or jsonb_typeof(operation -> 'changes') is distinct from 'array' then
    raise exception using errcode = '22023', message = '同步操作格式无效。';
  end if;
  if jsonb_array_length(operation -> 'changes') = 0 then
    raise exception using errcode = '22023', message = '同步操作不能为空。';
  end if;
  -- Bind the request to the account captured by the client before the network
  -- call. A refreshed/switched SDK session must not redirect another account's
  -- queued data into the newly authenticated account.
  if operation ? 'owner' then
    if jsonb_typeof(operation -> 'owner') is distinct from 'string' then
      raise exception using errcode = '42501', message = '同步账号已经变化，当前操作仍保留在原账号。';
    end if;
    begin
      if (operation ->> 'owner')::uuid is distinct from account then
        raise exception using errcode = '42501', message = '同步账号已经变化，当前操作仍保留在原账号。';
      end if;
    exception when invalid_text_representation then
      raise exception using errcode = '42501', message = '同步账号标识无效。';
    end;
  end if;
  v_operation_id := operation ->> 'id';
  insert into public.sync_state(owner, cursor) values (account, 0) on conflict (owner) do nothing;
  -- All account mutations serialize here, including receipts; cursor order equals commit order.
  select state.cursor into current_cursor from public.sync_state state where state.owner = account for update;
  select * into receipt from life_private.sync_receipts stored where stored.owner = account and stored.operation_id = v_operation_id;
  if found then
    if receipt.request is distinct from operation then
      raise exception using errcode = '22023', message = '操作编号已经使用，不能用同一编号提交不同内容。';
    end if;
    return receipt.result;
  end if;
  if exists (
    select 1 from jsonb_array_elements(operation -> 'changes') entry
    group by entry ->> 'kind', entry ->> 'id' having count(*) > 1
  ) then raise exception using errcode = '22023', message = '同一操作不能重复修改同一实体。'; end if;

  for change in select value from jsonb_array_elements(operation -> 'changes') loop
    if jsonb_typeof(change) is distinct from 'object' or jsonb_typeof(change -> 'kind') is distinct from 'string'
       or jsonb_typeof(change -> 'id') is distinct from 'string' or not (change ? 'base') or not (change ? 'next') then
      raise exception using errcode = '22023', message = '同步变更缺少必要字段。';
    end if;
    base_data := nullif(change -> 'base', 'null'::jsonb);
    next_data := nullif(change -> 'next', 'null'::jsonb);
    perform life_private.validate_entity(change ->> 'kind', change ->> 'id', base_data);
    perform life_private.validate_entity(change ->> 'kind', change ->> 'id', next_data);
    remote_data := null;
    select entity.data into remote_data from public.sync_entities entity
      where entity.owner = account and entity.kind = change ->> 'kind' and entity.id = change ->> 'id';
    remote_exists := found;
    begin
      if remote_exists and remote_data is null and next_data is not null then
        raise exception using errcode = 'P0001', message = '这份内容已在其他设备删除，请将本地修改保存为新副本。';
      end if;
      merged := life_private.merge_entity(change ->> 'kind', base_data, next_data, remote_data);
    exception when sqlstate 'P0001' then
      conflict_message := sqlerrm;
      exit;
    end;
    perform life_private.validate_entity(change ->> 'kind', change ->> 'id', merged);
    candidates := candidates || jsonb_build_array(jsonb_build_object('kind', change ->> 'kind', 'id', change ->> 'id', 'data', merged, 'changed', merged is distinct from remote_data));
    changed := changed or merged is distinct from remote_data;
  end loop;

  -- Validate changed focus against the final batch, so task creation/deletion order is irrelevant.
  -- Historical focus rows deliberately keep references when a task is later rescheduled.
  if conflict_message is null then
    for candidate in select value from jsonb_array_elements(candidates) where value ->> 'kind' = 'focus' and value ->> 'changed' = 'true' and value -> 'data' <> 'null'::jsonb loop
      for task_id in select jsonb_array_elements_text(candidate -> 'data' -> 'ids') loop
        select nullif(value -> 'data', 'null'::jsonb) into task_data from jsonb_array_elements(candidates)
          where value ->> 'kind' = 'tasks' and value ->> 'id' = task_id;
        if not found then
          select entity.data into task_data from public.sync_entities entity where entity.owner = account and entity.kind = 'tasks' and entity.id = task_id;
        end if;
        if task_data is null or task_data ? 'deletedAt' then conflict_message := '重点中的事项已删除或不存在，请重新选择。'; exit; end if;
      end loop;
      if conflict_message is not null then exit; end if;
    end loop;
  end if;

  if conflict_message is null and changed then
    current_cursor := current_cursor + 1;
    update public.sync_state set cursor = current_cursor where owner = account;
    for candidate in select value from jsonb_array_elements(candidates) loop
      merged := nullif(candidate -> 'data', 'null'::jsonb);
      if not exists (select 1 from public.sync_entities entity where entity.owner = account and entity.kind = candidate ->> 'kind' and entity.id = candidate ->> 'id' and entity.data is not distinct from merged)
         and not (merged is null and not exists (select 1 from public.sync_entities entity where entity.owner = account and entity.kind = candidate ->> 'kind' and entity.id = candidate ->> 'id')) then
        insert into public.sync_entities as entity(owner, kind, id, version, cursor, data)
          values (account, candidate ->> 'kind', candidate ->> 'id', 1, current_cursor, merged)
          on conflict (owner, kind, id) do update set version = entity.version + 1, cursor = excluded.cursor, data = excluded.data;
      end if;
    end loop;
  end if;
  response := jsonb_build_object('status', case when conflict_message is null then 'applied' else 'conflict' end,
    'cursor', current_cursor, 'entities', life_private.current_entities(account, operation -> 'changes'));
  if conflict_message is not null then response := response || jsonb_build_object('message', conflict_message); end if;
  insert into life_private.sync_receipts(owner, operation_id, request, result) values (account, v_operation_id, operation, response);
  return response;
end;
$$;

-- Remove the old overload first: keeping both would make one-argument/default
-- RPC calls ambiguous and could preserve an entry point without owner binding.
drop function if exists public.pull_changes(bigint);
drop function if exists life_private.pull_changes(bigint);

create or replace function life_private.pull_changes(after_cursor bigint default 0, expected_owner uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  account uuid := auth.uid();
  current_cursor bigint;
  entities jsonb;
begin
  if account is null or not exists (select 1 from public.app_owners where user_id = account) then
    raise exception using errcode = '42501', message = '仅预置的私人账户可以同步。';
  end if;
  if expected_owner is not null and expected_owner is distinct from account then
    raise exception using errcode = '42501', message = '同步账号已经变化，不能读取其他账号的内容。';
  end if;
  if after_cursor is null or after_cursor < 0 then raise exception using errcode = '22023', message = '同步游标无效。'; end if;
  insert into public.sync_state(owner, cursor) values (account, 0) on conflict (owner) do nothing;
  -- Block a writer until both the boundary and rows are read; never skip a late commit.
  select state.cursor into current_cursor from public.sync_state state where state.owner = account for share;
  if after_cursor > current_cursor then raise exception using errcode = '22023', message = '同步游标超出当前账户，请重新连接账户。'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'id', id, 'version', version, 'data', data) order by cursor, kind, id), '[]'::jsonb)
    into entities from public.sync_entities where owner = account and cursor > after_cursor and cursor <= current_cursor;
  return jsonb_build_object('cursor', current_cursor, 'entities', entities);
end;
$$;

create or replace function public.apply_operation(operation jsonb)
returns jsonb language sql security invoker set search_path = '' as $$ select life_private.apply_operation(operation); $$;
create or replace function public.pull_changes(after_cursor bigint default 0, expected_owner uuid default null)
returns jsonb language sql security invoker set search_path = '' as $$ select life_private.pull_changes(after_cursor, expected_owner); $$;

revoke all on function life_private.valid_day(text), life_private.validate_entity(text, text, jsonb), life_private.merge_entity(text, jsonb, jsonb, jsonb), life_private.current_entities(uuid, jsonb), life_private.apply_operation(jsonb), life_private.pull_changes(bigint, uuid) from public, anon, authenticated;
revoke all on function public.apply_operation(jsonb), public.pull_changes(bigint, uuid) from public, anon, authenticated;
grant execute on function life_private.apply_operation(jsonb), life_private.pull_changes(bigint, uuid) to authenticated;
grant execute on function public.apply_operation(jsonb), public.pull_changes(bigint, uuid) to authenticated;

comment on table public.app_owners is 'Admin-provisioned single private owner. No client enrollment or write grants.';
comment on table public.sync_entities is 'Private synced entities. SQL NULL is a retained hard tombstone; deletedAt is recoverable soft deletion.';
comment on function public.apply_operation(jsonb) is 'Atomic, receipt-idempotent three-way merge; owner comes exclusively from auth.uid().';
comment on function public.pull_changes(bigint, uuid) is 'Incremental current entities behind a per-owner commit-ordered cursor barrier; expected_owner binds requests across session changes.';

commit;
