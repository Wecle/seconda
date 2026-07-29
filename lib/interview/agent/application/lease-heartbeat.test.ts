import assert from "node:assert/strict";
import test from "node:test";
import { startLeaseHeartbeat } from "@/lib/interview/agent/application/lease-heartbeat";

async function waitUntil(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("Timed out waiting for condition");
}

test("never overlaps renewals and waits for an in-flight renewal on stop", async () => {
  let active = 0;
  let maximum = 0;
  let renewals = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const heartbeat = startLeaseHeartbeat({
    intervalMs: 1,
    async renew() {
      renewals += 1;
      active += 1;
      maximum = Math.max(maximum, active);
      await gate;
      active -= 1;
      return true;
    },
    onLeaseLost() {},
  });

  await waitUntil(() => active === 1);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(renewals, 1);
  assert.equal(active, 1);

  const stopping = heartbeat.stop();
  await Promise.resolve();
  assert.equal(active, 1);

  release();
  await stopping;
  assert.equal(maximum, 1);
  assert.equal(active, 0);
});

test("reports a false renewal once and schedules no later renewal", async () => {
  let renewals = 0;
  const leaseLosses: unknown[] = [];
  const heartbeat = startLeaseHeartbeat({
    intervalMs: 1,
    async renew() {
      renewals += 1;
      return false;
    },
    onLeaseLost(error) {
      leaseLosses.push(error);
    },
  });

  await waitUntil(() => leaseLosses.length === 1);
  await new Promise((resolve) => setTimeout(resolve, 10));
  await heartbeat.stop();

  assert.equal(renewals, 1);
  assert.equal(leaseLosses.length, 1);
  assert.match(String(leaseLosses[0]), /lease was lost/i);
});

test("reports a renewal exception once and schedules no later renewal", async () => {
  let renewals = 0;
  const leaseLosses: unknown[] = [];
  const failure = new Error("renewal failed");
  const heartbeat = startLeaseHeartbeat({
    intervalMs: 1,
    async renew() {
      renewals += 1;
      throw failure;
    },
    onLeaseLost(error) {
      leaseLosses.push(error);
    },
  });

  await waitUntil(() => leaseLosses.length === 1);
  await new Promise((resolve) => setTimeout(resolve, 10));
  await heartbeat.stop();

  assert.equal(renewals, 1);
  assert.deepEqual(leaseLosses, [failure]);
});
