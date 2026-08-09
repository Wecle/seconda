import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const roomPath = new URL("./agent-interview-room.tsx", import.meta.url);

test("room renders hydrated failure and switches to a replacement run", async () => {
  const source = await readFile(roomPath, "utf8");
  assert.match(source, /runFailurePresentation\(run\)/);
  assert.match(source, /runs\/\$\{run\.id\}\/retry/);
  assert.match(source, /重试本轮/);
  assert.match(source, /lastEventSequence: 0/);
  assert.match(source, /setRun\(\{[\s\S]+id: result\.runId/);
  assert.match(source, /retryFailedRun[\s\S]+beginAgentRoomRequest[\s\S]+runs\/\$\{run\.id\}\/retry/);
  assert.match(source, /result\.runStatus !== "running"\) await refresh\(\)/);
});
