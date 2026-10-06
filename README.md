# CF Free WebDAV

基于 Cloudflare Workers 和 R2 的单用户 WebDAV 服务。Worker 负责 WebDAV 请求、HTTPS 和 Basic Auth；私有 R2 bucket 保存文件。项目不需要常驻服务器或数据库。

## 一键部署

通过下面的按钮，可以将本项目部署到 Cloudflare，并在你的 GitHub 账户中创建项目副本：

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/CallMeKingsley97/cf-free-webdav)

部署流程：

1. 点击按钮，授权 Cloudflare 访问 GitHub，并选择 Worker 名称和新建的项目仓库。
2. 在部署配置页为 `WEBDAV_PASSWORD` 设置强随机密码。若部署流程没有询问该值，先完成部署，再在 Cloudflare Dashboard 的 **Settings → Variables and Secrets** 中新增同名 **Secret** 并部署新版本。
3. Cloudflare 会构建并部署 Worker。配置中的 R2 binding 未指定 bucket 名，Wrangler `4.45.0+` 会自动创建并绑定一个以 Worker 名称开头的 bucket。Wrangler 的[自动资源创建目前处于 Beta](https://developers.cloudflare.com/changelog/2025-10-24-automatic-resource-provisioning/)；通过 Cloudflare 仪表盘部署时，资源 ID 保存在 Cloudflare 账户中，不会写回 GitHub 仓库。
4. 等待部署完成后，WebDAV 地址为 `https://<worker-name>.<account-subdomain>.workers.dev/dav/`，用户名默认为 `webdav`。

服务在没有密码 Secret 时会对 `/dav/` 返回 `503` 并拒绝访问；设置 Secret 后即可使用。默认用户名为 `webdav`；需要更改时，修改 `wrangler.jsonc` 中的 `WEBDAV_USERNAME` 并重新部署。不要把密码写进 `wrangler.jsonc`、README 或 GitHub Actions 配置。

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
  storage/    R2 对象、目录和分页操作
  webdav/     WebDAV 方法路由与处理器
  index.ts    Worker 入口、健康检查和请求鉴权
  env.d.ts    密码 Secret 的类型补充声明
scripts/
  deploy.mjs  首次部署、交互设置密码、再次发布
```

## 开源

本项目使用 MIT License。Cloudflare 的部署按钮要求源仓库公开；如果将本项目设为私有，请改用本地 Wrangler 命令部署。
