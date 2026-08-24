import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { isSensitiveWorkspacePath, resolveWorkspacePath } from "../../path-policy";
import { AgentToolRegistry, type WorkspaceAgentToolContext } from "../../tool-registry";

const IGNORED_DIRECTORIES = new Set([".git", ".next", "node_modules"]);
const MAX_FILES = 500;
const MAX_FILE_CHARS = 16_000;
const MAX_SOURCE_BYTES = 1_000_000;

async function walkFiles(root: string, directory: string, signal: AbortSignal, output: string[]) {
  signal.throwIfAborted();
  if (output.length >= MAX_FILES) return;
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (output.length >= MAX_FILES) return;
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.relative(root, absolutePath);
    if (isSensitiveWorkspacePath(relativePath)) continue;
    if (entry.isDirectory()) await walkFiles(root, absolutePath, signal, output);
    else if (entry.isFile()) output.push(relativePath);
  }
}

function cropText(value: string, maxChars = MAX_FILE_CHARS) {
  if (value.length <= maxChars) return { content: value, truncated: false };
  const half = Math.floor((maxChars - 80) / 2);
  return {
    content: `${value.slice(0, half)}\n\n… ${value.length - half * 2} characters omitted …\n\n${value.slice(-half)}`,
    truncated: true,
  };
}

export function createWorkspaceToolRegistry() {
  const registry = new AgentToolRegistry<WorkspaceAgentToolContext>();

  registry.register({
    name: "list_files",
    description: "List files beneath a workspace directory. Use this to discover project structure.",
    inputSchema: z.object({ path: z.string().default(".") }),
    outputSchema: z.object({ path: z.string(), files: z.array(z.string()), truncated: z.boolean() }),
    async execute(rawInput, context) {
      const input = rawInput as { path: string };
      const resolved = await resolveWorkspacePath(context.workspaceRoot, input.path);
      if (!(await stat(resolved.absolutePath)).isDirectory()) throw new Error("Path is not a directory");
      const files: string[] = [];
      await walkFiles(resolved.root, resolved.absolutePath, context.signal, files);
      return { path: resolved.relativePath, files, truncated: files.length >= MAX_FILES };
    },
  });

  registry.register({
    name: "read_file",
    description: "Read a UTF-8 text file from the workspace, optionally selecting an inclusive line range.",
    inputSchema: z.object({
      path: z.string().min(1),
      startLine: z.number().int().positive().optional(),
      endLine: z.number().int().positive().optional(),
    }),
    outputSchema: z.object({ path: z.string(), content: z.string(), truncated: z.boolean() }),
    async execute(rawInput, context) {
      const input = rawInput as { path: string; startLine?: number; endLine?: number };
      const resolved = await resolveWorkspacePath(context.workspaceRoot, input.path);
      const metadata = await stat(resolved.absolutePath);
      if (!metadata.isFile()) throw new Error("Path is not a file");
      if (metadata.size > MAX_SOURCE_BYTES) throw new Error("File is too large to read safely");
      const source = await readFile(resolved.absolutePath, "utf8");
      const lines = source.split("\n");
      const start = Math.max(0, (input.startLine ?? 1) - 1);
      const end = Math.min(lines.length, input.endLine ?? lines.length);
      if (end < start) throw new Error("endLine must be greater than or equal to startLine");
      const cropped = cropText(lines.slice(start, end).join("\n"));
      return { path: resolved.relativePath, ...cropped };
    },
  });

  registry.register({
    name: "search_files",
    description: "Search UTF-8 workspace files for a literal text query and return matching lines.",
    inputSchema: z.object({
      query: z.string().min(1).max(200),
      path: z.string().default("."),
      maxResults: z.number().int().min(1).max(100).default(30),
    }),
    outputSchema: z.object({
      query: z.string(),
      matches: z.array(z.object({ path: z.string(), line: z.number(), text: z.string() })),
      truncated: z.boolean(),
    }),
    async execute(rawInput, context) {
      const input = rawInput as { query: string; path: string; maxResults: number };
      const resolved = await resolveWorkspacePath(context.workspaceRoot, input.path);
      const files: string[] = [];
      if ((await stat(resolved.absolutePath)).isDirectory()) await walkFiles(resolved.root, resolved.absolutePath, context.signal, files);
      else files.push(resolved.relativePath);
      const matches: { path: string; line: number; text: string }[] = [];
      for (const relativePath of files) {
        context.signal.throwIfAborted();
        let source: string;
        try {
          const absolutePath = path.join(resolved.root, relativePath);
          if ((await stat(absolutePath)).size > MAX_SOURCE_BYTES) continue;
          source = await readFile(absolutePath, "utf8");
        } catch {
          continue;
        }
        const lines = source.split("\n");
        for (let index = 0; index < lines.length; index += 1) {
          if (!lines[index].includes(input.query)) continue;
          matches.push({ path: relativePath, line: index + 1, text: lines[index].slice(0, 500) });
          if (matches.length >= input.maxResults) return { query: input.query, matches, truncated: true };
        }
      }
      return { query: input.query, matches, truncated: false };
    },
  });

  return registry;
}
