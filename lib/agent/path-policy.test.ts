import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveWorkspacePath } from "./path-policy";

test("resolves files inside the workspace", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "seconda-agent-"));
  try {
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "index.ts"), "export {}\n");
    const resolved = await resolveWorkspacePath(root, "src/index.ts");
    assert.equal(resolved.relativePath, path.join("src", "index.ts"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects traversal and symlinks outside the workspace", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "seconda-agent-"));
  const outside = await mkdtemp(path.join(tmpdir(), "seconda-outside-"));
  try {
    await writeFile(path.join(outside, "secret.txt"), "secret");
    await symlink(path.join(outside, "secret.txt"), path.join(root, "escape.txt"));
    await assert.rejects(resolveWorkspacePath(root, "../"), /outside the workspace/);
    await assert.rejects(resolveWorkspacePath(root, "escape.txt"), /outside the workspace/);
  } finally {
    await Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(outside, { recursive: true, force: true }),
    ]);
  }
});

test("protects credentials while allowing public environment examples", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "seconda-agent-"));
  try {
    await Promise.all([
      writeFile(path.join(root, ".env"), "SECRET=value\n"),
      writeFile(path.join(root, ".env.example"), "SECRET=example\n"),
      writeFile(path.join(root, ".npmrc"), "//registry/:_authToken=value\n"),
      writeFile(path.join(root, "deploy.pem"), "private\n"),
      writeFile(path.join(root, "credentials.json"), "{}\n"),
    ]);
    await assert.rejects(resolveWorkspacePath(root, ".env"), /protected/);
    await assert.rejects(resolveWorkspacePath(root, "deploy.pem"), /protected/);
    await assert.rejects(resolveWorkspacePath(root, ".npmrc"), /protected/);
    await assert.rejects(resolveWorkspacePath(root, "credentials.json"), /protected/);
    const example = await resolveWorkspacePath(root, ".env.example");
    assert.equal(example.relativePath, ".env.example");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
