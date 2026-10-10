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

## Free quota circuit breaker

The Worker tracks R2 Class A operations, Class B operations, and an estimated storage total in a Durable Object. When a metric reaches its configured threshold, write operations return `507 Insufficient Storage`; reads and deletes remain available so you can clean up data. Counters reset automatically at the start of each month.

Configure thresholds in `wrangler.jsonc` `vars`:

- `QUOTA_CLASS_A_MAX`: default `1000000`
- `QUOTA_CLASS_B_MAX`: default `10000000`
- `QUOTA_STORAGE_MAX_BYTES`: default `10737418240`
- `QUOTA_THRESHOLD_PERCENT`: default `0.8`, meaning writes stop at 80% of each limit
- `R2_BUCKET_NAME`: the real R2 bucket name used by official reconciliation; the default matches automatic provisioning (`cf-free-webdav-files`)

`GET /usage` (Basic Auth required) returns the current counters and whether the breaker is open. These are Worker-side estimates; direct R2 console/API access and R2 analytics lag are not included.

## Official usage reconciliation

## Web management page

Open the Worker root URL and sign in with your WebDAV username and password to browse directories, download, upload, and delete files. The page shows R2 storage and Class A/B operation free allowances, current usage, and progress bars. The "Sync official usage" button triggers an immediate official usage reconciliation.

The page calls `/api/files` for directory listings and usage state and reuses the same Basic Auth session. Storage progress follows the configured `QUOTA_STORAGE_MAX_BYTES`; official reconciliation affects the displayed usage.

To improve accuracy, configure a Cloudflare API Token with **Account → Account Analytics → Read** permission, then set these Secrets:

```bash
npx wrangler secret put CF_ACCOUNT_ID
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
  web/        Web management page and file/usage JSON API
  storage/    R2 objects, collections, and pagination
  webdav/     WebDAV method routing and handlers
  index.ts    Worker entry point, health check, and request authentication
  env.d.ts    Type declaration for the password Secret
scripts/
  deploy.mjs  First deployment, interactive password setup, and redeployment
```

## License

This project is licensed under the MIT License. The Deploy to Cloudflare button requires a public source repository. If you make this repository private, deploy with Wrangler from a local terminal instead.
