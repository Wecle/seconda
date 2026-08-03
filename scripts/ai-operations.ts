import postgres from "postgres";
import { queryAIOperations, type Sql } from "../lib/operations/ai-operations";
import {
  parseAIOperationsArgs,
  renderAIOperationsJSON,
  renderAIOperationsText,
} from "./ai-operations-cli";

async function main() {
  let args: ReturnType<typeof parseAIOperationsArgs>;
  try {
    args = parseAIOperationsArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Invalid AI operations arguments");
    process.exitCode = 1;
    return;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is required for AI operations queries");
    process.exitCode = 1;
    return;
  }

  let sql: ReturnType<typeof postgres> | undefined;
  try {
    sql = postgres(connectionString, { prepare: false, max: 1 });
    const report = await queryAIOperations(sql as unknown as Sql, {
      command: args.command,
      since: new Date(Date.now() - args.sinceMs),
      limit: args.limit,
      ...(args.interviewId ? { interviewId: args.interviewId } : {}),
    });
    console.log(args.json
      ? renderAIOperationsJSON(report)
      : renderAIOperationsText(report, args.command));
  } catch {
    console.error("AI operations query failed");
    process.exitCode = 1;
  } finally {
    await sql?.end({ timeout: 5 }).catch(() => undefined);
  }
}

void main();
