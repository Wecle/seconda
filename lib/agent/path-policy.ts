import { realpath } from "node:fs/promises";
import path from "node:path";

const DENIED_DIRECTORIES = new Set([".git", ".next", "node_modules", "uploads"]);
const DENIED_FILE_EXTENSIONS = new Set([".cer", ".crt", ".key", ".p12", ".p7b", ".pem", ".pfx"]);
const SAFE_DOTFILES = new Set([
  ".editorconfig",
  ".agents",
  ".dockerignore",
  ".env.example",
  ".eslintignore",
  ".gitattributes",
  ".gitignore",
  ".github",
  ".prettierignore",
]);
const DENIED_CREDENTIAL_FILES = new Set([
  "auth.json",
  "credentials.json",
  "service-account.json",
  "service_account.json",
]);

export function isSensitiveWorkspacePath(relativePath: string) {
  const segments = relativePath.split(path.sep);
  if (segments.some((segment) => DENIED_DIRECTORIES.has(segment))) return true;
  const filename = segments.at(-1)?.toLowerCase() ?? "";
  if (filename.startsWith(".") && !SAFE_DOTFILES.has(filename)) return true;
  if (DENIED_CREDENTIAL_FILES.has(filename)) return true;
  return DENIED_FILE_EXTENSIONS.has(path.extname(filename));
}

export async function resolveWorkspacePath(workspaceRoot: string, requestedPath: string) {
  const root = await realpath(workspaceRoot);
  const candidate = await realpath(path.resolve(root, requestedPath || "."));
  const relative = path.relative(root, candidate);

  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Path is outside the workspace");
  }
  if (isSensitiveWorkspacePath(relative)) throw new Error("Path is protected by workspace policy");

  return { root, absolutePath: candidate, relativePath: relative || "." };
}
