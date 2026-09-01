import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import * as schema from "./schema";

const BUILD_FALLBACK_URL = "postgresql://postgres:postgres@localhost:5432/seconda_placeholder";

interface HyperdriveBinding {
  connectionString?: string;
}

// Hyperdrive 是对象绑定，OpenNext 只把字符串绑定写进 process.env，
// 所以必须从 getCloudflareContext() 读；构建期 / 本地 next dev 没有运行时上下文，返回 undefined。
function getHyperdriveConnectionString(): string | undefined {
  try {
    const env = getCloudflareContext().env as Record<string, unknown>;
    return (env.HYPERDRIVE as HyperdriveBinding | undefined)?.connectionString || undefined;
  } catch {
    return undefined;
  }
}

function getConnectionString(): string {
  const hyperdriveUrl = getHyperdriveConnectionString();
  if (hyperdriveUrl) return hyperdriveUrl;

  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  // 仅构建期静态分析允许 placeholder；运行时缺配置要 fail fast，
  // 否则会伪装成诡异的连接超时（见 2026-09 排查的 auth Configuration 错误）。
  if (process.env.NEXT_PHASE === "phase-production-build") return BUILD_FALLBACK_URL;

  throw new Error(
    "Missing database configuration: bind a HYPERDRIVE binding or set the DATABASE_URL secret",
  );
}

let cachedClient: ReturnType<typeof postgres> | null = null;
let cachedDb: PostgresJsDatabase<typeof schema> | null = null;
let lastConnectionString = "";

export function getDb(): PostgresJsDatabase<typeof schema> {
  const currentConn = getConnectionString();
  if (!cachedDb || currentConn !== lastConnectionString) {
    lastConnectionString = currentConn;
    cachedClient = postgres(currentConn, {
      prepare: false,
      max: 1,
      idle_timeout: 0,
      connect_timeout: 10,
    });
    cachedDb = drizzle(cachedClient, { schema });
  }
  return cachedDb;
}

export const db = new Proxy({} as PostgresJsDatabase<typeof schema>, {
  get(_target, prop, receiver) {
    const instance = getDb();
    const value = Reflect.get(instance, prop, receiver);
    if (typeof value === "function") {
      return value.bind(instance);
    }
    return value;
  },
});

export async function closeDatabaseConnection() {
  if (cachedClient) {
    await cachedClient.end({ timeout: 5 });
    cachedClient = null;
    cachedDb = null;
  }
}
