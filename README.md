# 人生软件 · 模块桌面交互预览

[打开在线预览](https://az90010203-bit.github.io/life-software-preview/)

这是人生软件的模块桌面交互预览。使用原创观景室场景和圆润 SVG 图标，验证自由布置的个人空间。

进入「布置空间」后，可以拖动组件标题栏、靠近边缘或其他组件吸附、缩放面板，
并切换图标／卡片／面板。组件库可以添加同类组件的多份实例；收起仅移除桌面实例，
业务内容保留，移除后可以撤销。空桌面会保持为空，不自动重新添加组件。

内置随手记、月历和今日重点三个示例组件。同类实例共享记录，位置、尺寸和显示方式分别保存。
布局、记录和随手记草稿仅保存在当前浏览器的 localStorage；不同电脑之间尚未同步。
手机按列表显示，保留电脑的归一化布局坐标。

当前尚未实现原生插件宿主、独立插件安装／升级、Rust／SQLite 存储、云同步和 AI。
GitHub Pages 仅托管前端，不托管个人记录或本地数据库。

## 布局层与业务层

桌面以「功能模块 → 显示形态 → 桌面实例」分层。组件注册表声明名称和各形态尺寸，
桌面实例只保存实例 ID、模块类型、形态、归一化坐标、像素尺寸和层级；不携带业务记录。
布局内核独立管理恢复、校验、创建、形态切换和吸附。共享数据 Provider 管理业务内容，
拖动不会重新挂载实例，收起或变换形态也不删除已保存内容。

交互原型用于确认这些规则，未来正式插件 SDK 和原生存储接入时替换数据适配层。

## 技术

React、TypeScript、Vite。GitHub Actions 构建并部署到 GitHub Pages。
后续平台计划接入 Tauri、Rust、SQLite 和可独立安装的网页模块包。

## 本地开发

```powershell
npm ci
npm run dev
```

默认地址为 `http://127.0.0.1:4317/`，端口占用时直接退出。
本地开发模式提供只读的 `/__preview/health`，返回服务时间，禁止缓存。
`scripts/Start-Preview.ps1` 和 `scripts/Stop-Preview.ps1` 可以管理本机后台预览。

如果使用私有反向代理，可以通过 `LIFE_PREVIEW_ALLOWED_HOST` 精确允许额外主机名。

## 静态构建

```powershell
$env:PAGES_BASE_PATH = '/life-software-preview/'
npm run build:pages
```

输出位于 `dist/`。静态模式使用仓库子路径加载资源，并生成 `preview-status.json`，
记录页面构建时间，不连接开发电脑或本地数据库。

## 自动部署

推送到 `main` 后，`.github/workflows/pages.yml` 安装依赖、检查 TypeScript、构建网页并部署。
仓库的 GitHub Pages 发布来源设置为 GitHub Actions。

本项目不包含个人记录、访问凭据或数据库备份。
