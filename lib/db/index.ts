import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString =
  (process.env as unknown as { HYPERDRIVE?: { connectionString?: string } })
    .HYPERDRIVE?.connectionString || process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL or HYPERDRIVE connection string is not set."
  );
}

const client = postgres(connectionString, { prepare: false });
export const db = drizzle(client, { schema });

export async function closeDatabaseConnection() {
  await client.end({ timeout: 5 });
}
