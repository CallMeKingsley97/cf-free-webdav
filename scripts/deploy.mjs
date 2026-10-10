import { spawnSync } from "node:child_process";

const windows = process.platform === "win32";
const npx = windows ? "npx.cmd" : "npx";

function run(args, quiet = false) {
  const result = spawnSync(npx, ["wrangler", ...args], {
    stdio: quiet ? "ignore" : "inherit",
    shell: windows,
  });
  return !result.error && result.status === 0;
}

if (!run(["whoami"], true)) {
  console.error("请先运行 npx wrangler login 完成 Cloudflare 登录。");
  process.exit(1);
}

console.log("正在首次部署 Worker 并自动创建 R2 bucket...");
if (!run(["deploy"])) process.exit(1);

console.log("请确认 wrangler.jsonc 中 R2_BUCKET_NAME 与真实 bucket 名称一致，如有差异请修改后重新部署。");

console.log("请在 Wrangler 提示中输入 WebDAV 密码。");
if (!run(["secret", "put", "WEBDAV_PASSWORD"])) process.exit(1);

console.log("正在发布包含密码 Secret 的版本...");
if (!run(["deploy"])) process.exit(1);

console.log("部署完成。WebDAV 用户名默认为 webdav。");
