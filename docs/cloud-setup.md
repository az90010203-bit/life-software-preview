# 私人云端配置

本轮提供可重复执行的数据库迁移、客户端接入协议与本地 SQL 回归；这些文件本身不代表 Supabase 项目已经创建或部署。正式配置使用用户自己的 Supabase Free 项目，地区选择 Singapore；账号、项目和公开访问地址由主任务通过已连接的服务配置。不要为本步骤升级套餐或启用收费附加服务。

## 1. 预置唯一账号

1. 在 Supabase Authentication 的用户管理中，由项目管理员手动创建用户自己的邮箱／密码账号，并确认邮箱；密码只在管理界面和实际登录界面输入，不写入 SQL、Git、构建变量或聊天日志。
2. 在 Auth 的一般配置中关闭 **Allow new users to sign up**；关闭 **Allow anonymous sign-ins**。保留 Email 登录 provider，让已存在账号仍可使用邮箱密码登录。前端不提供公开注册。
3. 从用户管理取得该账号的 UUID。运行下节迁移后，由管理员把它加入 `app_owners`；不要增加 `auth.users` 自动登记触发器，也不要根据“第一个登录的人”自动授予权限。

关闭注册只限制新用户；真正的数据授权还由服务器端白名单和 RLS 验证。没有白名单的已认证账号也不能调用同步 RPC 或读取实体。[Auth 配置](https://supabase.com/docs/guides/auth/general-configuration)、[邮箱密码登录](https://supabase.com/docs/guides/auth/passwords)。

## 2. 迁移与白名单

在项目 SQL Editor 以管理员身份执行 `supabase/migrations/20261015_private_sync.sql` 的完整内容。也可使用已经配置好的 Supabase CLI 迁移流程；不要把数据库连接密码写入仓库。迁移在一个事务内执行，可以重复执行；不会删除已同步实体、游标或操作回执。

然后替换下面的 UUID 占位值，单独执行：

```sql
insert into public.app_owners(user_id)
values ('替换为用户管理中的账号UUID'::uuid)
on conflict (user_id) do nothing;

select user_id from public.app_owners;
```

白名单有单账号唯一约束，第二个不同账号会被数据库拒绝。迁移未填入真实账号 UUID，白名单为空时默认拒绝所有同步。管理员以后若要换账号，需另行处理旧账号数据和设备绑定，不直接以新账号覆盖原本的数据归属。

Data API 仅暴露现有 `public` schema，**不要把 `life_private` 加入 Exposed schemas**。`public.apply_operation` 与 `public.pull_changes` 是 invoker 包装；实际写入逻辑位于未公开 schema 的 definer 函数，固定空 `search_path` 并在内部检查 `auth.uid()` 与白名单。客户端仅有白名单内自己实体的 SELECT 权限；对实体、游标、白名单及回执的直接写权限全部撤销。[RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)、[函数权限](https://supabase.com/docs/guides/database/functions)。

## 3. 配置公开客户端参数

客户端构建只需要以下两个值：

```dotenv
VITE_SUPABASE_URL=https://你的项目.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_你的公开客户端key
```

本地放入被 Git 忽略的 `.env.local`；发布构建在 CI 注入同名变量。Vite 会把这两个值打包到公开 JavaScript，因此只使用 **publishable key**。不要填入 `sb_secret_...`、legacy `service_role`、数据库密码或用户密码；这些凭据可以越过 RLS，不能进入浏览器。仅有公开 key 不代表任何用户获准访问，RPC 还要求有效登录会话和管理员白名单。[API key 类型](https://supabase.com/docs/guides/getting-started/api-keys)。

发布后用预置的邮箱密码登录；客户端必须先成功调用 `pull_changes` 验证授权，再绑定账号、确认导入本机内容。现有公开 GitHub Pages 可以承载代码和美术素材，私人笔记与待办放在带认证的数据库中。不要将私人导出文件提交到仓库。

## 4. 同步协议与恢复

- `apply_operation(operation JSONB)`：`{id, owner?, changes:[{kind,id,base,next}]}`，应用始终发送排队操作所属账号的 owner；服务端要求其等于 `auth.uid()`，防止 SDK 在网络调用前切换会话后误传数据。省略 owner 只为兼容旧夹具。kind 为 `notes`／`tasks`／`focus`／`dayNotes`。数据对象不包含外层 `id`、本地 `revision`、owner 或服务器 version；notes／tasks 支持 `deletedAt` 软删除。`next:null` 为保留版本号的硬删除标记，不能被陈旧设备重新覆盖。
- 返回 `{status:'applied'|'conflict',cursor,entities,message?}`。每个受操作触及的实体都返回当前 `{kind,id,version,data}`；不存在的实体返回 `version:0,data:null`。同一操作编号与相同内容重试返回同一回执，换内容必须换操作编号。
- 相对于 base 逐字段合并；本地与云端同时修改同字段且值不同会冲突。缺失键视为删除字段；`updatedAt` 不制造冲突，但仍随本地改动合并。远端删除状态变化不能被普通编辑静默覆盖。
- 单个操作的多实体变更全部成功或全部不写入。focus 最多三个不重复 task id，变更后的重点必须引用最终批次中存在、未删除的事项。保留历史重点时不要求事项当前日期等于历史日期。
- `pull_changes(after_cursor BIGINT, expected_owner UUID DEFAULT NULL)` 返回 `{cursor,entities}`。应用始终发送本次同步捕获的账号 ID，若与执行 RPC 时的 `auth.uid()` 不同就拒绝读取；省略参数的旧调用仍可使用。每个账号通过同一 `sync_state` 行锁提交游标；pull 在读取边界和实体期间持有共享锁，避免较晚提交的数据被游标跳过。实体版本与游标全部由服务器生成。迁移会移除旧的单参数函数重载，重复执行不会保留绕过账号绑定的旧入口。

删除账号或清理云端前先使用应用的导出功能。不要手工清空回执、硬删除标记或重置游标：离线设备可能仍带有旧操作，直接清理会破坏幂等与增量同步。免费套餐存在配额和暂停规则；恢复网络或项目可用后继续同步，本地未提交内容应保留。[当前套餐说明](https://supabase.com/pricing)。

## 5. 验证与边界

`tests/supabase.test.ts` 在临时内存 PostgreSQL（PGlite/WASM）中执行迁移两次，并执行 `supabase/tests/*.sql`。仅测试用最小 `auth.users`／`auth.uid()` fixture 替代 Supabase Auth；SQL、PL/pgSQL、事务、RLS 和角色权限由真正的 PostgreSQL 执行。测试依赖仅用于开发和 CI，不进入浏览器运行包。

```powershell
npx vite build --ssr tests/supabase.test.ts --outDir output/supabase-tests
node --test output/supabase-tests/supabase.test.js
```

SQL 脚本也可在专用测试数据库以管理员身份执行；它们创建事务内测试用户并最终回滚，**不要拿真实生产账号运行测试夹具**。脚本包含匿名、非白名单账号、跨 owner 读取、直接写入禁止、三件重点、删除／恢复、字段合并、原子回滚、幂等及增量游标等断言。

本地单连接 WASM 回归不等同于真实 Supabase Auth／PostgREST／多连接并发验收。正式项目部署后还需核对：公开注册关闭、白名单只含本人、两个设备登录后增删改同步、离线重连、令牌过期、多个并发连接的提交游标，以及国内外实际网络可达性。不能仅凭地区为 Singapore 就承诺两地网络始终可用。

iPhone 的独立主屏幕 Web App 应按独立会话与缓存容器设计；同账号云数据会同步，本地 IndexedDB 和登录 token 不应假定跨安装共享。当前 SDK 将会话保存在本地存储，因此需要在各独立入口登录，不能依赖 iOS 安装时仅复制 cookies 的机制。[WebKit 安装与 cookies](https://webkit.org/blog/14787/webkit-features-in-safari-17-2/)。
