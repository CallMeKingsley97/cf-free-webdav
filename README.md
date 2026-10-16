# CF Free WebDAV

[English](README.md) | [简体中文](README.zh-CN.md)

A single-user WebDAV service built with Cloudflare Workers and R2. The Worker handles WebDAV requests, HTTPS, and Basic Authentication. Files are stored in a private R2 bucket. No always-on server or database is required.

If this project is useful to you, please consider giving it a star on [GitHub](https://github.com/CallMeKingsley97/cf-free-webdav).

## Deploy to Cloudflare

### Connect the existing GitHub repository

To deploy this repository and automatically publish future commits, connect the existing repository. Do not use the Deploy button below for this workflow.

1. In GitHub, open **Settings → Applications → Installed GitHub Apps** and confirm that **Cloudflare Workers and Pages** can access `CallMeKingsley97/cf-free-webdav`. Reauthorize or reinstall the app if Cloudflare reports that authorization has expired.
2. In the Cloudflare dashboard, go to **Workers & Pages → Create application → Get started (Import a repository)**.
3. Select your GitHub account, choose the existing `cf-free-webdav` repository and its `main` branch, then finish setup. This creates a Cloudflare Worker connected to the existing repository; it does not create a GitHub repository copy.
4. After deployment, open the Worker’s **Settings → Variables and Secrets** and add `WEBDAV_PASSWORD` as a **Secret**. Use a strong, unique password, then deploy the updated version.

Future pushes to `main` will trigger builds and deployments. The WebDAV URL is `https://<worker-name>.<account-subdomain>.workers.dev/dav/`; the default username is `webdav`. Wrangler creates the R2 bucket from the binding configuration. Automatic resource provisioning requires Wrangler `4.45.0` or later and is currently in [Beta](https://developers.cloudflare.com/changelog/2025-10-24-automatic-resource-provisioning/).

### Deploy a new project copy

The button below is for people who want to create their own GitHub repository from this project template. Cloudflare copies the source repository to the deployer’s GitHub account. This does not connect and deploy the current repository.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/CallMeKingsley97/cf-free-webdav)

Set `WEBDAV_PASSWORD` during the button flow if prompted. If the flow does not ask for it, finish deployment and add the Secret in the Worker settings as described above.

The service returns `503` for WebDAV requests until `WEBDAV_PASSWORD` is configured. The default username is `webdav`; to change it, edit `WEBDAV_USERNAME` in `wrangler.jsonc` and deploy again. Never put the password in `wrangler.jsonc`, this README, or GitHub Actions configuration.

## Configuration reference

Set non-secret values in the `vars` object in `wrangler.jsonc`, then deploy. Set Secrets with `npx wrangler secret put NAME` or in the Worker’s **Settings → Variables and Secrets**. For local development, put Secret values in the ignored `.dev.vars` file.

### Variables

| Name | Required | Default / format | Purpose |
| --- | --- | --- | --- |
| `WEBDAV_USERNAME` | No | `webdav` | Basic Auth username. |
| `QUOTA_CLASS_A_MAX` | No | `1000000`; positive number | Monthly Class A operation limit used by the write circuit breaker. |
| `QUOTA_CLASS_B_MAX` | No | `10000000`; positive number | Monthly Class B operation limit used by the write circuit breaker. |
| `QUOTA_STORAGE_MAX_BYTES` | No | `10737418240` (10 GiB); positive number | Storage limit in bytes used by the write circuit breaker and management page. |
| `QUOTA_THRESHOLD_PERCENT` | No | `0.8`; a ratio greater than `0` and at most `1` | Fraction of each limit at which writes are blocked. For example, `0.8` means 80%. |
| `R2_BUCKET_NAME` | No | `cf-free-webdav-files` | Actual bucket name queried during official usage reconciliation. Keep it aligned with the R2 bucket bound as `FILES`. |
| `TRASH_RETENTION_DAYS` | No | `30`; integer from `1` to `365` | Days before deleted files and saved versions are removed. Invalid values use `30`. |
| `FEISHU_ALERT_PERCENT` | No | `70`; percentage greater than `0` and at most `100` | Feishu warning threshold. Invalid values disable notifications. This does not change the write circuit breaker threshold. |
| `CF_ACCOUNT_ID` | Only for official reconciliation | No default; Cloudflare account ID | Account queried by the Analytics API. Set as a Worker variable. |

Quota limits are configurable caps, not billing controls. Invalid quota values fall back to the defaults shown above. `QUOTA_THRESHOLD_PERCENT` is a ratio, while `FEISHU_ALERT_PERCENT` is a percentage from 1 to 100.

### Secrets

| Name | Required | Purpose |
| --- | --- | --- |
| `WEBDAV_PASSWORD` | Yes | Basic Auth password. The service does not accept WebDAV or management requests until it is set. |
| `CF_API_TOKEN` | Only for official reconciliation | Cloudflare API token with **Account → Account Analytics → Read** permission. Configure together with `CF_ACCOUNT_ID`. |
| `SHARE_SECRET` | No | Separate HMAC signing key for share links. If omitted, `WEBDAV_PASSWORD` is used; changing the signing key invalidates existing links. |
| `FEISHU_WEBHOOK_URL` | No | Feishu custom bot webhook. Setting it enables threshold notifications during reconciliation. |
| `FEISHU_WEBHOOK_SECRET` | No | Feishu signing secret; required only when signature verification is enabled for the bot. |

For example, configure the required password and optional Cloudflare token with:

```bash
npx wrangler secret put WEBDAV_PASSWORD
npx wrangler secret put CF_API_TOKEN
```

### Cloudflare bindings and scheduled work

| Name | Requirement | Type | Purpose |
| --- | --- | --- | --- |
| `FILES` | Required for file operations | R2 bucket binding | Stores user files, trash, and versions. Declared under `r2_buckets` in `wrangler.jsonc`; the project uses Wrangler automatic resource provisioning. |
| `USAGE_STORE` | Required for management, quota, and share features | Durable Object binding | Stores quota counters, usage history, and managed share-link state. Its binding and SQLite migration are declared in `wrangler.jsonc`. |
| Cron `0 */6 * * *` | Enabled by default | Scheduled Worker trigger | Runs trash cleanup and official usage reconciliation every six hours (UTC). It is declared under `triggers.crons` in `wrangler.jsonc`. |

The `FILES` and `USAGE_STORE` bindings are provisioned by Wrangler and are not configured as variables or Secrets. If automatic R2 provisioning is unavailable, create/enable the R2 bucket in Cloudflare and make sure `R2_BUCKET_NAME` matches its name.

## Free quota circuit breaker

The Worker tracks R2 Class A operations, Class B operations, and an estimated storage total in a Durable Object. When a metric reaches its configured threshold, write operations return `507 Insufficient Storage`; reads and deletes remain available so you can clean up data. Counters reset automatically at the start of each month.

`GET /usage` (Basic Auth required) returns the current counters and whether the breaker is open. These are Worker-side estimates; direct R2 console/API access and R2 analytics lag are not included.

## Usage trend

The Durable Object records a daily usage snapshot (Class A/B operations, storage, breaker state) in its built-in SQLite table. The management page shows a 30-day sparkline under each quota card so you can see how fast allowances are consumed. Snapshots are recorded on every write operation and on official reconciliation, and are kept for 60 days.

## Threshold alerts (Feishu)

To avoid silent write-outs, the Worker can push an alert to a Feishu (Lark) bot webhook when any metric crosses a warning percentage during official reconciliation. Configure these Secrets:

```bash
npx wrangler secret put FEISHU_WEBHOOK_URL    # Feishu custom bot webhook URL
npx wrangler secret put FEISHU_WEBHOOK_SECRET # Optional; required only if the bot enables signature verification
```

- `FEISHU_ALERT_PERCENT` (optional var in `wrangler.jsonc`): alert percentage, default `70`. The breaker itself still trips at `QUOTA_THRESHOLD_PERCENT`.
- Alerts are sent when scheduled reconciliation (every 6 hours) or a manual "Sync official usage" runs and any metric is at or above the alert percentage.
- If the bot enables signature verification, set `FEISHU_WEBHOOK_SECRET`; the Worker generates the Feishu signed payload automatically.

## Web management page

Open the Worker root URL and sign in with your WebDAV username and password to browse directories, create folders, rename, download, upload, and delete files. The page supports recursive search, sorting, multi-select actions, and previews for images, audio, video, and plain text files smaller than 1 MiB. It shows R2 storage and Class A/B operation allowances, current usage, and progress bars. The "Sync official usage" button triggers an immediate official usage reconciliation. Uploads show live progress, and you can drag files onto the file list to upload them.

The page calls `/api/files` for directory listings and usage state and reuses the same Basic Auth session. Storage progress follows the configured `QUOTA_STORAGE_MAX_BYTES`; official reconciliation affects the displayed usage.

### Trash and file versions

The Trash view can restore deleted files and collections, permanently delete selected items, or empty the trash. WebDAV `DELETE` moves resources to trash. Replacing a file, or overwriting a destination with `COPY` or `MOVE`, retains the replaced content as a version. Restoring a deleted item requires its original path to be free; restoring a version archives the current content as a new version. Items expire after `TRASH_RETENTION_DAYS` and are cleaned up every six hours.

Trash and versions remain in R2 and count toward storage usage. Permanent deletion or expiration releases that space. Archiving generates additional R2 Class A operations, which are included in the usage estimate. The `.__cf_free_webdav__` object prefix is reserved for internal data and cannot be used as a user directory.

## Share links

The management page can generate signed download links for individual files. New links are recorded in the Durable Object and can be listed, copied, and individually or bulk revoked from the Share Links view. They can also have a maximum access count. Links work without Basic Auth until they expire and support HTTP range requests; each Range request counts toward the access limit.

- Validity periods: 1 hour, 1 day, 7 days, or 30 days.
- Links are HMAC-SHA256 signed; revocation state and access counts are stored.
- Only files can be shared, not collections.
- Links created before this update remain valid until they expire, but are not listed or individually revocable. Rotating the signing secret invalidates them.
- By default the signature key falls back to `WEBDAV_PASSWORD`. To decouple share links from the WebDAV password, set an optional `SHARE_SECRET` secret:

```bash
npx wrangler secret put SHARE_SECRET
```

## Upload inbox, file map, and folder pages

- **Upload inbox**: create a link for the current folder with a 1-, 7-, or 30-day lifetime. Visitors can upload but cannot browse or download. Each file is limited to 100 MB and each link accepts up to 100 files. Uploads stay in a hidden staging area until you keep or delete them from the Inbox view. Keeping a file adds a suffix when its destination name already exists, so it never overwrites another file.
- Inbox URLs are signed with `SHARE_SECRET`, falling back to `WEBDAV_PASSWORD`; changing the signing secret invalidates existing inbox links. Active links can be copied again from the management view.
- **File map**: open File Map from the file view to recursively scan the current folder in pages, up to 10,000 files. Tile area can represent size, file count, or recent modification activity; colors can represent size, type, or modification time. Select a folder to drill down or a file to open it. Larger folders show the scanned portion, and you can continue from a subfolder.
- **Folder page**: publish a photo wall or file showcase for the current folder. The published file list is a snapshot with up to 300 supported files. Photo walls embed only JPEG, PNG, GIF, WebP, and AVIF images. File showcases additionally support PDF, TXT, and MD downloads. HTML, scripts, SVG, and other types are excluded. Revoke pages from the Public Pages view.

These features need no additional Cloudflare bindings. Inbox links, pending uploads, and published snapshots use the existing `USAGE_STORE` Durable Object.

## Official usage reconciliation

To improve accuracy, configure a Cloudflare API Token with **Account → Account Analytics → Read** permission, set `CF_ACCOUNT_ID` as a Worker variable, and add the token as a Secret:

```bash
npx wrangler secret put CF_API_TOKEN
```

A scheduled cron job runs every 6 hours and queries the Cloudflare GraphQL Analytics API (`r2OperationsAdaptiveGroups` and `r2StorageAdaptiveGroups`). It compares official usage against local counters and takes the higher value, preventing under-counting when R2 is accessed outside the Worker. Configure `QUOTA_THRESHOLD_PERCENT` in `wrangler.jsonc` (default `0.8`) to control when writes stop.

The Deploy to Cloudflare button requires a public source repository. Your Cloudflare account must have Workers and R2 enabled. If automatic resource provisioning is unavailable for your account or deployment flow, enable R2 in Cloudflare and deploy from a local terminal instead:

```bash
npm install
npx wrangler login
npm run deploy:setup
```

The setup script deploys the Worker and creates the R2 bucket, prompts for the password through Wrangler, then deploys a version with the Secret configured. For later code updates, run `npm run deploy`.

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars
# Edit .dev.vars and set a local password
npm run typecheck
npm run dev
```

Wrangler uses a local R2 simulation during development; local files are not synchronized with Cloudflare. `.dev.vars` is ignored by Git. The `dev`, `deploy`, and `typecheck` scripts generate `worker-configuration.d.ts` from `wrangler.jsonc`; this generated file is not committed.

## Supported WebDAV methods

| Method | Behavior |
| --- | --- |
| `OPTIONS` | Returns supported methods and DAV capabilities |
| `PROPFIND` | Returns XML `207 Multi-Status`; supports `Depth: 0` and `Depth: 1` |
| `PROPPATCH` | Parses property requests and rejects unsupported, non-persistent properties with property-level `403` responses |
| `GET`, `HEAD` | Downloads files, reads metadata, and supports byte ranges |
| `PUT` | Uploads or replaces files and preserves common HTTP metadata |
| `MKCOL` | Creates a collection (directory) |
| `DELETE` | Deletes a file or a collection and its children |
| `COPY`, `MOVE` | Copies or moves files and collections |

Authentication uses HTTPS Basic Authentication. The R2 bucket remains private and is accessible only through the Worker. Directories are represented by R2 object-key prefixes; empty directories use zero-byte marker objects ending in `/`.

## Limitations

- This project implements a practical subset of WebDAV for personal use. `LOCK` and `UNLOCK` are not supported. Custom dead properties are not persisted, and `PROPPATCH` returns property-level `403` responses. Clients that require locks or custom properties may not synchronize correctly.
- `COPY` and `MOVE` copy object data and are not atomic. Recursive directory operations are limited to 1,000 objects per request.
- Deletion copies resources into the trash first; recursive directory archives are also limited to 1,000 objects. The `.__cf_free_webdav__` prefix is reserved for internal objects.
- Trash archives continue to count toward Class A usage so cleanup remains available after the write breaker opens. Internal archive writes bypass that breaker but are still counted, so large deletions can push Class A usage beyond the warning threshold. Permanently deleting trash releases storage, not operation counts.
- Directory `PROPFIND` uses R2 `ListObjects`, which counts as a Class A operation. Frequent sync requests can consume the monthly free allowance.
- Cloudflare Free accounts have a 100 MB maximum request body size, so a single WebDAV `PUT` cannot upload a larger file. Multipart uploads require additional protocol support from both the client and server.
- Current R2 Standard free allowances include 10 GB-month of storage, 1 million Class A operations, and 10 million Class B operations per month. Workers Free includes 100,000 inbound requests per day. R2 egress is free. Usage beyond included allowances may incur charges. Check the [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), and [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) pages for current terms.
- R2 must be enabled on your Cloudflare account. Configure usage alerts and check billing regularly; free allowances are not a hard spending limit.

## Project structure

```text
.
  wrangler.jsonc       Worker, R2 binding, and variable configuration
  package.json         Development, type generation, and deployment scripts
  tsconfig.json        Strict TypeScript configuration
  .dev.vars.example    Local Secret example; contains no real password
  .gitignore           Excludes dependencies, build output, and local Secrets
  LICENSE              MIT License
  README.md            English project documentation
  README.zh-CN.md      Simplified Chinese project documentation
src/
  auth/       Basic Authentication
  http/       WebDAV path parsing and HTTP/XML responses
  web/        Web management page and file/usage/share/inbox/gallery JSON APIs
  features/   Persistent record types for inboxes and folder pages
  share/      Signed share link signing and verification
  monitor/    Quota tracking, Durable Object usage store, and reconciliation
  notify/     Feishu threshold alerts
  storage/    R2 objects, collections, and pagination
  webdav/     WebDAV method routing and handlers
  index.ts    Worker entry point, health check, and request authentication
  env.d.ts    Type declaration for the password Secret
scripts/
  deploy.mjs  First deployment, interactive password setup, and redeployment
```

## Friendly Links

- [LINUX DO](https://linux.do/) — A community for sharing and discussing technology, software, and digital life.
- [V2EX](https://www.v2ex.com/) — A community of developers and creative minds.

## License

This project is licensed under the MIT License. The Deploy to Cloudflare button requires a public source repository. If you make this repository private, deploy with Wrangler from a local terminal instead.
