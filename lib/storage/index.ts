import { getCloudflareContext } from "@opennextjs/cloudflare";

interface R2ObjectBodyLike {
  arrayBuffer(): Promise<ArrayBuffer>;
  httpMetadata?: { contentType?: string };
  size: number;
}

interface R2BucketBinding {
  put(
    key: string,
    value: Buffer | Uint8Array | ArrayBuffer,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<R2ObjectBodyLike | null>;
  delete(key: string): Promise<void>;
}

// R2 原生 binding（wrangler.jsonc 的 r2_buckets），不走 S3 HTTP API：
// @aws-sdk/client-s3 在 Workers 上会因 fs.readFile 崩溃，且原生 binding
// 免签名、免 secrets、走 Cloudflare 内部网络。
function getBucket(): R2BucketBinding {
  const env = getCloudflareContext().env as Record<string, unknown>;
  const bucket = env.R2 as R2BucketBinding | undefined;
  if (!bucket) {
    throw new Error(
      "Missing R2 binding: add an r2_buckets binding named R2 to wrangler.jsonc",
    );
  }
  return bucket;
}

function normalizeKey(pathname: string): string {
  if (pathname.startsWith("http://") || pathname.startsWith("https://")) {
    try {
      const parsed = new URL(pathname);
      return parsed.pathname.replace(/^\/+/, "");
    } catch {
      return pathname.replace(/^\/+/, "");
    }
  }
  return pathname.replace(/^\/+/, "");
}

export interface PutBlobOptions {
  contentType?: string;
  access?: "public" | "private";
}

export async function putBlob(
  pathname: string,
  body: Buffer | Uint8Array | ArrayBuffer,
  options?: PutBlobOptions
): Promise<{ key: string; pathname: string }> {
  const key = normalizeKey(pathname);

  await getBucket().put(key, body, {
    httpMetadata: {
      contentType: options?.contentType || "application/octet-stream",
    },
  });

  return {
    key,
    pathname: key,
  };
}

export async function getBlob(pathname: string): Promise<{
  body: Uint8Array;
  contentType?: string;
  contentLength?: number;
}> {
  const key = normalizeKey(pathname);
  const object = await getBucket().get(key);

  if (!object) {
    throw new Error(`Failed to read object from R2: ${pathname}`);
  }

  return {
    body: new Uint8Array(await object.arrayBuffer()),
    contentType: object.httpMetadata?.contentType,
    contentLength: object.size,
  };
}

export async function deleteBlob(urlOrKey: string | string[]): Promise<void> {
  const items = Array.isArray(urlOrKey) ? urlOrKey : [urlOrKey];
  const keys = items.map(normalizeKey).filter(Boolean);

  if (keys.length === 0) return;

  const bucket = getBucket();
  for (const key of keys) {
    await bucket.delete(key);
  }
}
