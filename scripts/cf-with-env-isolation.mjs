#!/usr/bin/env node
/**
 * Cloudflare 构建/部署的环境隔离包装器。
 *
 * OpenNext 在打包阶段会直接读取项目根目录的 .env* 文件，把内容编译进
 * worker bundle（.open-next/cloudflare/next-env.mjs），运行时作为兜底
 * 环境注入。因此仅在 buildCommand（next build）期间隐藏文件是不够的——
 * .env.production.local 等 Vercel 生产文件会在 OpenNext 打包阶段被整体
 * 嵌入 worker（数据库密码、OAuth secrets、AUTH_URL 等全部泄露）。
 *
 * 本脚本把隔离窗口扩大到整个被包装命令的生命周期（通常是
 * `opennextjs-cloudflare build`），结束后恢复文件。
 *
 * 用法：node scripts/cf-with-env-isolation.mjs <command> [args...]
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const rootDir = process.cwd();

// OpenNext extractProjectEnvVars 会读取的全部文件名。
// .env.cloudflare / .dev.vars 是非标准命名，不在其读取范围。
const ENV_FILES = [
  ".env",
  ".env.local",
  ".env.production",
  ".env.production.local",
  ".env.development",
  ".env.development.local",
  ".env.test",
  ".env.test.local",
];

const TMP_SUFFIX = ".cf-tmp";

function restoreFile(f) {
  const tmpPath = path.join(rootDir, f + TMP_SUFFIX);
  const origPath = path.join(rootDir, f);
  if (fs.existsSync(tmpPath) && !fs.existsSync(origPath)) {
    fs.renameSync(tmpPath, origPath);
  }
}

// 恢复上次异常中断残留的 .cf-tmp
for (const f of ENV_FILES) {
  restoreFile(f);
}

const hidden = ENV_FILES.filter((f) => fs.existsSync(path.join(rootDir, f)));

function restoreAll() {
  for (const f of hidden) {
    restoreFile(f);
  }
}

process.on("SIGINT", () => {
  restoreAll();
  process.exit(130);
});

process.on("SIGTERM", () => {
  restoreAll();
  process.exit(143);
});

for (const f of hidden) {
  fs.renameSync(path.join(rootDir, f), path.join(rootDir, f + TMP_SUFFIX));
}

const command = process.argv.slice(2);
if (command.length === 0) {
  console.error(
    "Usage: node scripts/cf-with-env-isolation.mjs <command> [args...]",
  );
  restoreAll();
  process.exit(1);
}

try {
  const result = spawnSync(command[0], command.slice(1), {
    stdio: "inherit",
    env: { ...process.env, CF_ENV_ISOLATED: "1" },
    shell: true,
  });
  process.exitCode = result.status ?? 1;
} finally {
  // 注意：不能用 process.exit()，它会立即终止进程导致 finally 不执行、文件无法恢复
  restoreAll();
}
