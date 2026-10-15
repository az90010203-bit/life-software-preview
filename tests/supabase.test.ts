import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

// This uses real PostgreSQL/WASM for SQL, row-level security, grants and PL/pgSQL.
// Supabase Auth itself is outside this local test: only its uid() boundary and
// auth.users foreign-key target are replaced by minimal deterministic fixtures.
const bootstrap = `
  create role anon;
  create role authenticated;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$
    select coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
    )::uuid
  $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
`;

test('Supabase SQL migration repeats safely and its PostgreSQL regression scripts pass', async (suite) => {
  const db = new PGlite();
  try {
    await db.exec(bootstrap);
    const migration = await readFile(resolve('supabase/migrations/20261015_private_sync.sql'), 'utf8');
    await suite.test('migration can run twice without dropping data', async () => {
      await db.exec(migration);
      await db.exec(`
        insert into auth.users(id,email) values ('33333333-3333-4333-8333-333333333333','repeat-test@example.invalid');
        insert into public.sync_entities(owner,kind,id,version,cursor,data) values
          ('33333333-3333-4333-8333-333333333333','notes','migration-preserved',1,1,'{"text":"preserved"}');
        create function life_private.pull_changes(after_cursor bigint) returns jsonb language sql as $$ select '{"legacy":true}'::jsonb $$;
        create function public.pull_changes(after_cursor bigint) returns jsonb language sql as $$ select '{"legacy":true}'::jsonb $$;
      `);
      await db.exec(migration);
      const result = await db.query<{ text: string }>("select data ->> 'text' as text from public.sync_entities where id = 'migration-preserved'");
      assert.equal(result.rows[0]?.text, 'preserved');
      const signatures = await db.query<{ legacy: boolean; current: boolean }>("select to_regprocedure('public.pull_changes(bigint)') is null as legacy, to_regprocedure('public.pull_changes(bigint,uuid)') is not null as current");
      assert.deepEqual(signatures.rows[0], { legacy: true, current: true });
    });
    for (const filename of (await readdir(resolve('supabase/tests'))).filter((name) => name.endsWith('.sql')).sort()) {
      await suite.test(filename, async () => {
        await db.exec(await readFile(resolve('supabase/tests', filename), 'utf8'));
      });
    }
    await suite.test('named RPC arguments and JSON responses match the TypeScript wire protocol', async () => {
      await db.exec(`
        insert into public.app_owners(user_id) values ('33333333-3333-4333-8333-333333333333');
        delete from public.sync_entities where owner = '33333333-3333-4333-8333-333333333333';
        set role authenticated;
        select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',false);
      `);
      const owner = '33333333-3333-4333-8333-333333333333';
      const operation = { id: 'wire-operation', owner, changes: [{ kind: 'notes', id: 'wire-note', base: null, next: { text: '协议核对' } }] };
      const applied = await db.query<{ result: { status: string; cursor: number; entities: unknown[] } }>(
        'select public.apply_operation(operation => $1::jsonb) as result', [JSON.stringify(operation)],
      );
      assert.deepEqual(applied.rows[0].result, {
        status: 'applied', cursor: 1,
        entities: [{ kind: 'notes', id: 'wire-note', version: 1, data: { text: '协议核对' } }],
      });
      const pulled = await db.query<{ result: { cursor: number; entities: unknown[] } }>(
        'select public.pull_changes(after_cursor => $1::bigint, expected_owner => $2::uuid) as result', [0, owner],
      );
      assert.deepEqual(pulled.rows[0].result, { cursor: 1, entities: applied.rows[0].result.entities });
      await db.exec('reset role');
    });
  } finally {
    await db.close();
  }
});
