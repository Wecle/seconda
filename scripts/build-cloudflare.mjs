import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const rootDir = process.cwd();
const envFile = path.join(rootDir, ".env.cloudflare");

const targetFiles = [
  ".env.production.local",
  ".env.local",
  ".env.development.local",
];

// 如果上次构建异常中断残留了 .cf-tmp 文件，先恢复
for (const f of targetFiles) {
  const tmpPath = path.join(rootDir, `${f}.cf-tmp`);
  const origPath = path.join(rootDir, f);
  if (fs.existsSync(tmpPath) && !fs.existsSync(origPath)) {
    fs.renameSync(tmpPath, origPath);
  }
}

// 收集需要临时屏蔽的 Vercel / Local 本地环境文件，防止 Next.js 内置 @next/env 自动加载
const filesToHide = targetFiles.filter((f) => fs.existsSync(path.join(rootDir, f)));

function restoreFiles() {
  for (const f of filesToHide) {
    const tmpPath = path.join(rootDir, `${f}.cf-tmp`);
    const origPath = path.join(rootDir, f);
    if (fs.existsSync(tmpPath)) {
      fs.renameSync(tmpPath, origPath);
    }
  }
}

process.on("SIGINT", () => {
  restoreFiles();
  process.exit(130);
});

process.on("SIGTERM", () => {
  restoreFiles();
  process.exit(143);
});

// 临时重命名这些文件
for (const f of filesToHide) {
  fs.renameSync(path.join(rootDir, f), path.join(rootDir, `${f}.cf-tmp`));
}

try {
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

  const result = spawnSync("next", ["build"], {
    stdio: "inherit",
    env,
    shell: true,
  });

  if (result.status !== null && result.status !== 0) {
    process.exit(result.status);
  }
} finally {
  restoreFiles();
}
