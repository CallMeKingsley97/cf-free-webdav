# CF Free WebDAV

[English](README.md) | 简体中文

基于 Cloudflare Workers 和 R2 的单用户 WebDAV 服务。Worker 负责 WebDAV 请求、HTTPS 和 Basic Auth；私有 R2 bucket 保存文件。项目不需要常驻服务器或数据库。

如果这个项目对你有帮助，欢迎在 [GitHub 给项目点个 Star](https://github.com/CallMeKingsley97/cf-free-webdav)，支持后续改进。

## 部署到 Cloudflare

### 连接已有 GitHub 仓库

如果要部署当前仓库并让后续 GitHub 提交自动发布，请连接已有仓库，不要使用下面的 Deploy 按钮。

1. 在 GitHub 的 **Settings → Applications → Installed GitHub Apps** 中打开 **Cloudflare Workers and Pages**，确认它有权访问 `CallMeKingsley97/cf-free-webdav`。若 Cloudflare 提示授权过期，按提示重新授权或安装该应用。
2. 在 Cloudflare Dashboard 打开 **Workers & Pages → Create application → Get started（Import a repository）**。
3. 选择 GitHub 账户和已有的 `cf-free-webdav` 仓库，选择 `main` 分支并完成创建。这个流程会创建 Cloudflare Worker 并连接现有仓库，不会要求创建 GitHub 仓库副本。
4. 部署完成后，在该 Worker 的 **Settings → Variables and Secrets** 中新增 `WEBDAV_PASSWORD`，类型选择 **Secret**，填写强随机密码并部署新版本。

后续推送到 `main` 会自动构建和部署。WebDAV 地址为 `https://<worker-name>.<account-subdomain>.workers.dev/dav/`，用户名默认为 `webdav`。首次部署的 R2 bucket 由 Wrangler 根据配置创建；该功能要求 Wrangler `4.45.0+`，目前处于[自动资源创建 Beta](https://developers.cloudflare.com/changelog/2025-10-24-automatic-resource-provisioning/)。

### 部署为一个新的项目副本

下面的按钮适用于其他人想从本项目模板创建自己的 GitHub 仓库。Cloudflare 会复制源仓库到部署者的 GitHub 账户；这不是连接并部署当前仓库的方式。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/CallMeKingsley97/cf-free-webdav)

使用按钮时，在部署流程中填写 `WEBDAV_PASSWORD`。如果页面没有要求设置，先完成部署，再按上面的步骤在 Worker 设置中添加 Secret。

服务在没有密码 Secret 时会对 `/dav/` 返回 `503` 并拒绝访问；设置 Secret 后即可使用。默认用户名为 `webdav`；需要更改时，修改 `wrangler.jsonc` 中的 `WEBDAV_USERNAME` 并重新部署。不要把密码写进 `wrangler.jsonc`、README 或 GitHub Actions 配置。

## 配置参数

普通变量配置在 `wrangler.jsonc` 的 `vars` 中，修改后重新部署。Secret 可使用 `npx wrangler secret put NAME` 设置，或在 Worker 的 **Settings → Variables and Secrets** 中添加。本地开发时，将 Secret 写入已被 Git 忽略的 `.dev.vars`。

### 普通变量

| 名称 | 是否必需 | 默认值 / 格式 | 用途 |
| --- | --- | --- | --- |
| `WEBDAV_USERNAME` | 否 | `webdav` | Basic Auth 用户名。 |
| `QUOTA_CLASS_A_MAX` | 否 | `1000000`；正数 | 每月 Class A 操作上限，用于写入熔断。 |
| `QUOTA_CLASS_B_MAX` | 否 | `10000000`；正数 | 每月 Class B 操作上限，用于写入熔断。 |
| `QUOTA_STORAGE_MAX_BYTES` | 否 | `10737418240`（10 GiB）；正数 | 存储上限，单位为字节，用于写入熔断和管理页面进度。 |
| `QUOTA_THRESHOLD_PERCENT` | 否 | `0.8`；大于 `0` 且不超过 `1` 的比例 | 达到配额上限的多少比例时停止写入。例如 `0.8` 表示 80%。 |
| `R2_BUCKET_NAME` | 否 | `cf-free-webdav-files` | 官方用量校准查询的实际 bucket 名称；应与绑定到 `FILES` 的 bucket 一致。 |
| `TRASH_RETENTION_DAYS` | 否 | `30`；`1` 到 `365` 的整数 | 回收站和历史版本的保留天数。无效值会回退为 `30`。 |
| `FEISHU_ALERT_PERCENT` | 否 | `70`；大于 `0` 且不超过 `100` 的百分数 | 飞书预警线。无效值会关闭通知，不会改变写入熔断阈值。 |
| `CF_ACCOUNT_ID` | 仅官方校准需要 | 无默认值；Cloudflare Account ID | Analytics API 查询的账户 ID，作为 Worker 普通变量设置。 |

配额数值是 Worker 内部的熔断上限，不是账单限额。无效的配额配置会使用上表默认值。`QUOTA_THRESHOLD_PERCENT` 使用比例格式，`FEISHU_ALERT_PERCENT` 使用 1 到 100 的百分数格式。

### Secret

| 名称 | 是否必需 | 用途 |
| --- | --- | --- |
| `WEBDAV_PASSWORD` | 是 | Basic Auth 密码。未设置时，WebDAV 和管理页面请求不可用。 |
| `CF_API_TOKEN` | 仅官方校准需要 | 具有 **Account → Account Analytics → Read** 权限的 Cloudflare API Token，需与 `CF_ACCOUNT_ID` 同时配置。 |
| `SHARE_SECRET` | 否 | 分享链接独立的 HMAC 签名密钥。未设置时使用 `WEBDAV_PASSWORD`；更换密钥会使已有链接失效。 |
| `FEISHU_WEBHOOK_URL` | 否 | 飞书自定义机器人 webhook。设置后会在用量校准时发送阈值通知。 |
| `FEISHU_WEBHOOK_SECRET` | 否 | 飞书签名密钥；仅机器人开启签名校验时需要。 |

设置必需密码和可选的 Cloudflare API Token：

```bash
npx wrangler secret put WEBDAV_PASSWORD
npx wrangler secret put CF_API_TOKEN
```

### Cloudflare 资源绑定与定时任务

| 名称 | 要求 | 类型 | 用途 |
| --- | --- | --- | --- |
| `FILES` | 文件操作必需 | R2 bucket binding | 保存用户文件、回收站和历史版本，在 `wrangler.jsonc` 的 `r2_buckets` 中声明；项目使用 Wrangler 自动创建资源。 |
| `USAGE_STORE` | 管理、配额和分享功能必需 | Durable Object binding | 保存配额计数、用量历史和分享链接状态；binding 与 SQLite migration 都在 `wrangler.jsonc` 中声明。 |
| Cron `0 */6 * * *` | 默认启用 | Worker 定时触发器 | 每 6 小时（UTC）清理过期回收站内容并校准官方用量，在 `wrangler.jsonc` 的 `triggers.crons` 中声明。 |

`FILES` 和 `USAGE_STORE` 由 Wrangler 配置资源绑定，不是普通变量或 Secret。若当前 Cloudflare 账户无法自动创建 R2，请先在 Cloudflare 中启用/创建 bucket，并确保 `R2_BUCKET_NAME` 与其名称一致。

## 免费额度熔断

Worker 会在 Durable Object 中记录 R2 Class A 操作数、Class B 操作数和存储量估算值。任一指标达到阈值后，写入操作返回 `507 Insufficient Storage`；读取和删除仍可用，便于清理数据。计数每月自动重置。

`GET /usage`（需要 Basic Auth）返回当前计数和熔断状态。这些是 Worker 侧估算值；不包含直接使用 R2 控制台/API 的用量，Cloudflare 官方统计也有延迟。可参考下文的官方用量校准提升精度。

## 用量趋势

Durable Object 会在内置 SQLite 表中按天记录用量快照（A/B 类操作、存储、熔断状态）。管理页面的每张额度卡片下方会展示最近 30 天的迷你趋势图，方便看出额度消耗速度。快照在每次写操作和官方校准时记录，保留 60 天。

## 熔断预警（飞书）

为避免写入悄悄被熔断，官方校准时若任一指标超过预警百分比，Worker 会推送到飞书自定义机器人 webhook。配置以下 Secret：

```bash
npx wrangler secret put FEISHU_WEBHOOK_URL     # 飞书自定义机器人 webhook 地址
npx wrangler secret put FEISHU_WEBHOOK_SECRET  # 可选；仅当机器人开启签名校验时需要
```

- `FEISHU_ALERT_PERCENT`（`wrangler.jsonc` 可选变量）：预警百分比，默认 `70`。熔断本身仍按 `QUOTA_THRESHOLD_PERCENT` 触发。
- 定时校准（每 6 小时）或手动点击“同步官方用量”时，若任一指标达到预警百分比即发送通知。
- 机器人若开启签名校验，设置 `FEISHU_WEBHOOK_SECRET` 即可，Worker 会自动生成飞书签名。

## Web 管理页面

访问 Worker 根路径并输入 WebDAV 用户名和密码，可以浏览目录、新建文件夹、重命名、下载、上传和删除文件。页面支持递归搜索、排序、多选批量操作，以及图片、音频、视频和小于 1 MiB 的纯文本预览。页面展示 R2 存储与 Class A/B 操作的免费额度、当前用量和使用进度；“同步官方用量”按钮会立即触发一次官方用量校准。上传时显示实时进度，也可以把文件直接拖拽到文件列表上传。

页面通过 `/api/files` 获取目录列表和用量状态，复用同一个 Basic Auth 会话。存储进度按配置的 `QUOTA_STORAGE_MAX_BYTES` 展示，官方校准结果会影响展示值。

### 回收站与版本恢复

管理页的“回收站”视图可以恢复已删除的文件和目录，也可以单条或批量永久删除、清空回收站。WebDAV `DELETE` 会移入回收站；覆盖文件以及覆盖式 `COPY`、`MOVE` 会保留被替换内容作为历史版本。恢复删除项要求原路径空闲；恢复历史版本会把当前内容另存为新版本。项目每 6 小时清理超过 `TRASH_RETENTION_DAYS` 的内容。

回收站和历史版本仍占用 R2 存储，并计入用量；永久删除或到期清理才会释放空间。归档文件会产生额外 R2 Class A 操作，配额面板会计入这些操作。系统保留 `.__cf_free_webdav__` 作为内部对象前缀，不能用作用户文件目录。

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

## 外链收件箱、文件星图与目录主页

- **外链收件箱**：在文件页为当前目录生成 1 天、7 天或 30 天有效的上传链接。访客只能上传，不能浏览或下载；单个文件最大 100 MB，每条链接最多接收 100 个文件。文件先保存在隐藏暂存区，在管理页“收件箱”视图中逐个保留或删除。保留时若目标文件名已存在，会自动添加序号，不会覆盖原文件。
- 收件链接使用 `SHARE_SECRET` 签名，未配置时回退到 `WEBDAV_PASSWORD`；变更签名密钥会使已有收件链接失效。管理页可重新复制仍有效的链接。
- **文件星图**：文件页的“文件星图”会递归扫描当前目录，以分页方式载入最多 10,000 个文件。面积可按文件大小、文件数或近期修改活跃度显示，颜色可切换为大小、类型或修改时间；点击目录可继续下钻，点击文件可打开。超过 10,000 个文件时显示已扫描部分，可进入子目录查看。
- **目录主页**：在文件页发布当前目录的照片墙或文件展示页。发布时冻结文件清单，最多包含 300 个受支持文件；照片墙只内嵌 JPEG、PNG、GIF、WebP 和 AVIF，文件展示额外支持 PDF、TXT 和 MD 下载。HTML、脚本、SVG 等类型不会公开。主页可在“公开主页”视图中撤销。

收件链接和目录主页都不需要新增 Cloudflare binding；链接状态、待确认项和发布快照保存在现有 `USAGE_STORE` Durable Object 中。

## 官方用量校准

为提高精度，可创建一个具有 **Account → Account Analytics → Read** 权限的 Cloudflare API Token，将 `CF_ACCOUNT_ID` 设为 Worker 普通变量，并将 Token 设为 Secret：

```bash
npx wrangler secret put CF_API_TOKEN
```

Worker 会通过定时任务（每 6 小时）调用 Cloudflare GraphQL Analytics API（`r2OperationsAdaptiveGroups` 和 `r2StorageAdaptiveGroups`），将官方口径的用量与本地计数对比后取较大值。这样即使有绕过 Worker 的 R2 访问，也不会低估用量。阈值可通过 `wrangler.jsonc` 中的 `QUOTA_THRESHOLD_PERCENT` 配置（默认 `0.8`）。

Deploy to Cloudflare 按钮要求源仓库公开。账号需要启用 Workers 和 R2；若账号或部署流程尚未提供自动创建资源能力，请先在 Cloudflare 中开通 R2，再使用命令行部署。也可从本地终端部署：

```bash
npm install
npx wrangler login
npm run deploy:setup
```

脚本会先部署 Worker 并创建 R2 bucket，然后由 Wrangler 安全地提示输入密码，最后发布设置了 Secret 的版本。之后更新代码可运行 `npm run deploy`。

## 本地开发

```bash
npm install
cp .dev.vars.example .dev.vars
# 编辑 .dev.vars，替换为自己的本地密码
npm run typecheck
npm run dev
```

本地开发使用 Wrangler 的本地 R2 模拟存储；本地文件不会自动同步到 Cloudflare。`.dev.vars` 已加入 `.gitignore`。
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
  wrangler.jsonc       Cloudflare Worker、R2 binding 和变量配置
  package.json         开发、类型生成、本地运行和部署命令
  tsconfig.json        TypeScript 严格类型检查
  .dev.vars.example    本地开发的 Secret 示例，不存储真实密码
  .gitignore           排除依赖、构建输出和本地 Secret
  LICENSE              MIT License
  README.md             部署、开发和功能说明
src/
  auth/       Basic Auth 验证
  http/       WebDAV 路径解析与 HTTP/XML 响应
  web/        Web 管理页面与文件/用量/分享/收件/主页 JSON 接口
  features/   收件箱和目录主页的持久化记录类型
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
