import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import * as schema from "./schema";

const BUILD_FALLBACK_URL = "postgresql://postgres:postgres@localhost:5432/seconda_placeholder";

interface HyperdriveBinding {
  connectionString?: string;
}

interface DbEntry {
  client: ReturnType<typeof postgres>;
  db: PostgresJsDatabase<typeof schema>;
  connectionString: string;
}

// Workers 的 outbound socket 生命周期绑定请求上下文（OpenNext 每次请求
// 创建新的 AsyncLocalStorage store）。模块级缓存的连接跨请求复用会
// 间歇性挂死：socket 被运行时回收后处于半死状态（写成功、读不回）。
// 因此 Workers 内按请求缓存连接（WeakMap<请求上下文>，随请求 GC），
// 非 Workers 环境（next dev / node 迁移脚本 / 构建期）保持进程级缓存。
const requestDbCache = new WeakMap<object, DbEntry>();
let processDbCache: DbEntry | null = null;

function resolveConnectionString(env: Record<string, unknown>): string {
  const hyperdriveUrl = (env.HYPERDRIVE as HyperdriveBinding | undefined)
    ?.connectionString;
  if (hyperdriveUrl) return hyperdriveUrl;

  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  // 仅构建期静态分析允许 placeholder；运行时缺配置要 fail fast，
  // 否则会伪装成诡异的连接超时（见 2026-09 排查的 auth Configuration 错误）。
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return BUILD_FALLBACK_URL;
  }

  throw new Error(
    "Missing database configuration: bind a HYPERDRIVE binding or set the DATABASE_URL secret",
  );
}

function createDbEntry(connectionString: string): DbEntry {
  const client = postgres(connectionString, {
    prepare: false,
    max: 1,
    idle_timeout: 0,
    connect_timeout: 10,
  });
  return { client, db: drizzle(client, { schema }), connectionString };
}

function getDbEntry(): DbEntry {
  try {
    const context = getCloudflareContext() as unknown as { env?: Record<string, unknown> };
    const conn = resolveConnectionString(context.env ?? {});
    let entry = requestDbCache.get(context);
    if (!entry || entry.connectionString !== conn) {
      entry = createDbEntry(conn);
      requestDbCache.set(context, entry);
    }
    return entry;
  } catch {
    // 非 Workers 上下文（构建期 / next dev / 迁移脚本）
    const conn = resolveConnectionString({});
    if (!processDbCache || processDbCache.connectionString !== conn) {
      processDbCache = createDbEntry(conn);
    }
    return processDbCache;
  }
}

export function getDb(): PostgresJsDatabase<typeof schema> {
  return getDbEntry().db;
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
  // 仅针对非 Workers 环境的进程级连接；Workers 内连接随请求上下文回收
  if (processDbCache) {
    await processDbCache.client.end({ timeout: 5 });
    processDbCache = null;
  }
}
