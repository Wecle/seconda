import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

function getConnectionString(): string {
  return (
    (process.env as unknown as { HYPERDRIVE?: { connectionString?: string } })
      ?.HYPERDRIVE?.connectionString ||
    process.env.DATABASE_URL ||
    "postgresql://postgres:postgres@localhost:5432/seconda_placeholder"
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
