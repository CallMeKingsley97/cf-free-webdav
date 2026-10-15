# CF Free WebDAV

[English](README.md) | 简体中文

基于 Cloudflare Workers 的多存储后端单用户 WebDAV 服务。Worker 负责 WebDAV 请求、HTTPS、Basic Auth 和管理页面；文件可以保存在可选的 R2 或 OneDrive 后端。项目不需要常驻服务器。

如果这个项目对你有帮助，欢迎在 [GitHub 给项目点个 Star](https://github.com/CallMeKingsley97/cf-free-webdav)，支持后续改进。

## 部署到 Cloudflare

### 连接已有 GitHub 仓库

如果要部署当前仓库并让后续 GitHub 提交自动发布，请连接已有仓库，不要使用下面的 Deploy 按钮。

1. 在 GitHub 的 **Settings → Applications → Installed GitHub Apps** 中打开 **Cloudflare Workers and Pages**，确认它有权访问 `CallMeKingsley97/cf-free-webdav`。若 Cloudflare 提示授权过期，按提示重新授权或安装该应用。
2. 在 Cloudflare Dashboard 打开 **Workers & Pages → Create application → Get started（Import a repository）**。
3. 选择 GitHub 账户和已有的 `cf-free-webdav` 仓库，选择 `main` 分支并完成创建。这个流程会创建 Cloudflare Worker 并连接现有仓库，不会要求创建 GitHub 仓库副本。
4. 部署完成后，在该 Worker 的 **Settings → Variables and Secrets** 中新增 `WEBDAV_PASSWORD`，类型选择 **Secret**，填写强随机密码并部署新版本。

后续推送到 `main` 会自动构建和部署。WebDAV 地址为 `https://<worker-name>.<account-subdomain>.workers.dev/dav/`，用户名默认为 `webdav`。项目不再要求 R2 绑定；未配置存储后端时 Worker 仍可部署，但文件列表为空。

### 配置 OneDrive 后端

在 Microsoft Entra 中注册一个应用，添加 Web 重定向地址：

```text
https://<worker-domain>/auth/onedrive/callback
```

在 Worker Secrets 中设置：

```bash
npx wrangler secret put ONEDRIVE_CLIENT_ID
npx wrangler secret put ONEDRIVE_CLIENT_SECRET
npx wrangler secret put ONEDRIVE_TENANT
```

部署后访问 `/auth/onedrive/start` 完成授权，将回调页显示的 refresh token 设置为：

```bash
npx wrangler secret put ONEDRIVE_REFRESH_TOKEN
```

管理页根目录会显示 `onedrive/` 挂载目录；上传时可以选择目标存储后端。OneDrive 文件实际保存在 `CF Free WebDAV` 文件夹下。

### 部署为一个新的项目副本

下面的按钮适用于其他人想从本项目模板创建自己的 GitHub 仓库。Cloudflare 会复制源仓库到部署者的 GitHub 账户；这不是连接并部署当前仓库的方式。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/CallMeKingsley97/cf-free-webdav)

使用按钮时，在部署流程中填写 `WEBDAV_PASSWORD`。如果页面没有要求设置，先完成部署，再按上面的步骤在 Worker 设置中添加 Secret。

服务在没有密码 Secret 时会对 `/dav/` 返回 `503` 并拒绝访问；设置 Secret 后即可使用。默认用户名为 `webdav`；需要更改时，修改 `wrangler.jsonc` 中的 `WEBDAV_USERNAME` 并重新部署。不要把密码写进 `wrangler.jsonc`、README 或 GitHub Actions 配置。

## 用量统计

Worker 会在 Durable Object 中记录操作数和存储估算。外部存储服务的实际免费额度由服务商控制，项目不会读取第三方官方剩余额度。

在 `wrangler.jsonc` 的 `vars` 中配置阈值：

- `QUOTA_THRESHOLD_PERCENT`：默认 `0.8`，即达到各上限的 80% 后停止写入
- `TRASH_RETENTION_DAYS`：回收站和文件版本的保留天数，默认 `30`，有效范围为 `1` 到 `365`

`GET /usage`（需要 Basic Auth）返回当前计数和熔断状态。这些是 Worker 侧估算值；不包含直接使用 R2 控制台/API 的用量，Cloudflare 官方统计也有延迟。可参考下文的官方用量校准提升精度。

## 官方用量校准（仅 R2 后端）

## 用量趋势

Durable Object 会在内置 SQLite 表中按天记录用量快照（A/B 类操作、存储、熔断状态）。管理页面的每张额度卡片下方会展示最近 30 天的迷你趋势图，方便看出额度消耗速度。快照在每次写操作和官方校准时记录，保留 60 天。

## 熔断预警（飞书，主要用于 R2 后端）

为避免写入悄悄被熔断，官方校准时若任一指标超过预警百分比，Worker 会推送到飞书自定义机器人 webhook。配置以下 Secret：

```bash
npx wrangler secret put FEISHU_WEBHOOK_URL     # 飞书自定义机器人 webhook 地址
npx wrangler secret put FEISHU_WEBHOOK_SECRET  # 可选；仅当机器人开启签名校验时需要
```

- `FEISHU_ALERT_PERCENT`（`wrangler.jsonc` 可选变量）：预警百分比，默认 `70`。熔断本身仍按 `QUOTA_THRESHOLD_PERCENT` 触发。
- 定时校准（每 6 小时）或手动点击“同步官方用量”时，若任一指标达到预警百分比即发送通知。
- 机器人若开启签名校验，设置 `FEISHU_WEBHOOK_SECRET` 即可，Worker 会自动生成飞书签名。

## Web 管理页面

访问 Worker 根路径并输入 WebDAV 用户名和密码，可以浏览多个后端目录、新建文件夹、重命名、下载、上传和删除文件。页面支持递归搜索、排序、多选批量操作，以及图片、音频、视频和小于 1 MiB 的纯文本预览。文件列表会显示来源后端，上传时可以选择目标后端。

页面通过 `/api/files` 获取目录列表和用量状态，复用同一个 Basic Auth 会话。

### 回收站与版本恢复

管理页的“回收站”视图可以恢复已删除的文件和目录，也可以单条或批量永久删除、清空回收站。WebDAV `DELETE` 会移入回收站；覆盖文件以及覆盖式 `COPY`、`MOVE` 会保留被替换内容作为历史版本。恢复删除项要求原路径空闲；恢复历史版本会把当前内容另存为新版本。项目每 6 小时清理超过 `TRASH_RETENTION_DAYS` 的内容。

外部后端的删除由服务商回收站或删除策略处理；当前 OneDrive 后端不使用项目自建 R2 回收站。

## 分享链接

管理页面可以为单个文件生成签名下载链接。新链接会记录在 Durable Object 中，可在“分享链接”视图查看、复制或单条/批量撤销，也可设置访问次数上限。链接在过期前无需 Basic Auth 即可访问，并支持 HTTP Range 请求，可直接交给播放器流式播放；每个 Range 请求都会计入访问次数。

- 有效期可选：1 小时、1 天、7 天或 30 天。
- 链接使用 HMAC-SHA256 签名，并保存撤销状态和访问次数。
- 仅支持分享文件，不支持分享目录。
- 升级前生成的旧格式链接仍可访问到原过期时间，但不会出现在管理列表中，不能单独撤销；轮换签名密钥可使旧链接失效。
- 签名密钥默认回退为 `WEBDAV_PASSWORD`。如需与 WebDAV 密码解耦，可设置可选的 `SHARE_SECRET`：

```bash
npx wrangler secret put SHARE_SECRET
```

为提高精度，可创建一个具有 **Account → Account Analytics → Read** 权限的 Cloudflare API Token，并设置以下 Secret：

```bash
npx wrangler secret put CF_ACCOUNT_ID
npx wrangler secret put CF_API_TOKEN
```

Worker 会通过定时任务（每 6 小时）调用 Cloudflare GraphQL Analytics API（`r2OperationsAdaptiveGroups` 和 `r2StorageAdaptiveGroups`），将官方口径的用量与本地计数对比后取较大值。这样即使有绕过 Worker 的 R2 访问，也不会低估用量。阈值可通过 `wrangler.jsonc` 中的 `QUOTA_THRESHOLD_PERCENT` 配置（默认 `0.8`）。

Deploy to Cloudflare 按钮要求源仓库公开。部署不需要启用 R2。也可从本地终端部署：

```bash
npm install
npx wrangler login
npm run deploy:setup
```

脚本会部署 Worker，然后由 Wrangler 安全地提示输入密码，最后发布设置了 Secret 的版本。之后更新代码可运行 `npm run deploy`。

## 本地开发

```bash
npm install
cp .dev.vars.example .dev.vars
# 编辑 .dev.vars，替换为自己的本地密码
npm run typecheck
npm run dev
```

本地开发使用外部后端配置；`.dev.vars` 已加入 `.gitignore`。没有配置 OneDrive 或 R2 时，Worker 仍可启动，但不会显示文件后端。
`npm run dev`、`npm run deploy` 和 `npm run typecheck` 会先从 `wrangler.jsonc` 生成本地类型文件 `worker-configuration.d.ts`；该文件不提交到 Git。

## 支持范围

| 方法 | 行为 |
| --- | --- |
| `OPTIONS` | 返回服务支持的方法和 DAV 能力 |
| `PROPFIND` | 返回 XML `207 Multi-Status`；支持 `Depth: 0` 和 `Depth: 1` |
| `PROPPATCH` | 识别属性请求并以 `207 Multi-Status` 拒绝未持久化的属性修改 |
| `GET`、`HEAD` | 下载文件、读取文件属性和字节范围 |
| `PUT` | 上传或覆盖文件，保留常用 HTTP 元数据 |
| `MKCOL` | 创建目录 |
| `DELETE` | 删除文件或目录及其子项 |
| `COPY`、`MOVE` | 复制或移动文件和目录 |

认证使用 HTTPS Basic Auth。R2 bucket 保持私有，只能通过 Worker 访问。目录以 R2 object key 前缀表示；空目录使用以 `/` 结尾的零字节对象标记。

## 限制

- 这是面向个人使用的 WebDAV 常用功能子集，暂不支持 `LOCK` 和 `UNLOCK`。自定义死属性不会持久化，`PROPPATCH` 会返回属性级 `403`；依赖锁或自定义属性的客户端可能无法正常同步。
- `COPY` 和 `MOVE` 通过读取后写入对象实现，不是原子操作。目录递归操作最多处理 1000 个对象，以限制单个请求的资源消耗。
- 删除会先把文件复制到回收站，再删除原对象；目录归档同样受 1000 个对象限制。内部前缀 `.__cf_free_webdav__` 为系统保留名称。
- 为保证清理操作在写入熔断后仍可使用，回收站归档会继续记入 Class A 用量，但内部归档写入不受写入熔断拦截；大量删除可能使 Class A 估算超过预警阈值。可永久清理回收站释放存储，但已发生的操作计数不会回退。
- `PROPFIND` 目录枚举会调用 R2 `ListObjects`，计入 A 类操作；大量同步客户端可能较快消耗该月免费额度。
- Cloudflare Free 账户的单次请求体上限为 100 MB，因此单次 WebDAV `PUT` 不能上传超过该大小的文件。大文件分块上传需要客户端和服务端共同支持额外协议。
- Cloudflare 当前的 R2 Standard 免费额度为每月 10 GB-month 存储、100 万次 A 类操作、1000 万次 B 类操作；Worker Free 包含每天 10 万次入站请求。出站流量免费，超出免费用量可能产生费用。以 Cloudflare 控制台和[官方定价页](https://developers.cloudflare.com/r2/pricing/)、[Workers 定价页](https://developers.cloudflare.com/workers/platform/pricing/)、[请求限制页](https://developers.cloudflare.com/workers/platform/limits/)为准。
- 启用 R2 需要在 Cloudflare 账户中完成 R2 开通流程。请配置用量告警并定期检查账单；免费额度不是支出硬上限。

## 项目结构

```text
.
  wrangler.jsonc       Cloudflare Worker 和变量配置
  package.json         开发、类型生成、本地运行和部署命令
  tsconfig.json        TypeScript 严格类型检查
  .dev.vars.example    本地开发的 Secret 示例，不存储真实密码
  .gitignore           排除依赖、构建输出和本地 Secret
  LICENSE              MIT License
  README.md             部署、开发和功能说明
src/
  auth/       Basic Auth 验证
  http/       WebDAV 路径解析与 HTTP/XML 响应
  web/        Web 管理页面与文件/用量/分享 JSON 接口
  share/      分享链接的签名与验证
  monitor/    配额统计、Durable Object 用量存储与官方校准
  notify/     飞书阈值预警通知
  storage/    R2 对象、目录和分页操作
  webdav/     WebDAV 方法路由与处理器
  index.ts    Worker 入口、健康检查和请求鉴权
  env.d.ts    密码 Secret 的类型补充声明
scripts/
  deploy.mjs  首次部署、交互设置密码、再次发布
```

## 友情链接

- [LINUX DO](https://linux.do/) — 真实、友好的技术社区，分享与讨论技术和数字生活。
- [V2EX](https://www.v2ex.com/) — 创意工作者与开发者的社区。

## 开源

本项目使用 MIT License。Cloudflare 的部署按钮要求源仓库公开；如果将本项目设为私有，请改用本地 Wrangler 命令部署。
