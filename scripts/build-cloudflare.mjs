/**
 * OpenNext buildCommand：仅负责用 .env.cloudflare 的值驱动 `next build`。
 *
 * 文件级隔离（隐藏 Vercel 的 .env* 文件）由外层
 * scripts/cf-with-env-isolation.mjs 负责——OpenNext 打包阶段会直接读取
 * 根目录 .env* 文件生成 next-env.mjs 快照并嵌入 worker，隔离必须覆盖
 * 整个 opennextjs-cloudflare build 周期，在 buildCommand 内部做来不及
 * （buildCommand 退出时文件已被恢复）。
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const rootDir = process.cwd();
const envFile = path.join(rootDir, ".env.cloudflare");

const env = { ...process.env };

if (fs.existsSync(envFile)) {
  const content = fs.readFileSync(envFile, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      env[key] = val;
    }
  }
}

if (!("AUTH_URL" in env)) {
  env.AUTH_URL = "";
}
if (!("NEXTAUTH_URL" in env)) {
  env.NEXTAUTH_URL = "";
}

// 防呆：未经过外层隔离包装直接构建时，提醒 .env* 文件会被嵌进 worker
if (!process.env.CF_ENV_ISOLATED) {
  const risky = [
    ".env.production.local",
    ".env.local",
    ".env",
  ].filter((f) => fs.existsSync(path.join(rootDir, f)));
  if (risky.length > 0) {
    console.warn(
      `[build-cloudflare] 警告：检测到 ${risky.join(", ")} 存在且未启用环境隔离。` +
        `OpenNext 会把这些文件的内容（含密钥）编译进 worker bundle。` +
        `请改用 pnpm build / pnpm deploy:worker（自动走 cf-with-env-isolation.mjs）。`,
    );
  }
}

const result = spawnSync("next", ["build"], {
  stdio: "inherit",
  env,
  shell: true,
});

if (result.status !== null && result.status !== 0) {
  process.exit(result.status);
}
