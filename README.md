# 人生软件 · 平台预览

[打开在线预览](https://az90010203-bit.github.io/life-software-preview/)

这是人生软件的首个网页预览，用于验证用户可以从不同电脑直接打开界面。
目前包含平台入口空态和网页访问测试，插件宿主、个人数据存储、日记、待办、提醒和 AI 尚未接入。
GitHub Pages 版本是静态网页，访问测试仅确认已部署页面正常响应。

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
显示页面构建时间，不连接开发电脑或本地数据库。

## 自动部署

推送到 `main` 后，`.github/workflows/pages.yml` 安装依赖、检查 TypeScript、构建网页并部署。
仓库的 GitHub Pages 发布来源设置为 GitHub Actions。

本项目不包含个人记录、访问凭据或数据库备份。
