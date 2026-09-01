import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";

function getS3Client() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "Missing R2 credentials: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, or R2_SECRET_ACCESS_KEY is not set."
    );
  }

  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
}

function toUint8Array(data: Buffer | Uint8Array | ArrayBuffer): Uint8Array {
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (data instanceof Uint8Array) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return new Uint8Array(data);
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
  const client = getS3Client();
  const bucketName = process.env.R2_BUCKET_NAME;
  if (!bucketName) {
    throw new Error("R2_BUCKET_NAME environment variable is not set.");
  }

  const key = normalizeKey(pathname);
  const uint8 = toUint8Array(body);

  await client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: uint8,
      ContentType: options?.contentType || "application/octet-stream",
    })
  );

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
  const client = getS3Client();
  const bucketName = process.env.R2_BUCKET_NAME;
  if (!bucketName) {
    throw new Error("R2_BUCKET_NAME environment variable is not set.");
  }

  const key = normalizeKey(pathname);
  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: key,
  });

  const response = await client.send(command);
  const bytes = await response.Body?.transformToByteArray();

  if (!bytes) {
    throw new Error(`Failed to read object from R2: ${pathname}`);
  }

  return {
    body: bytes,
    contentType: response.ContentType,
    contentLength: response.ContentLength,
  };
}

export async function deleteBlob(urlOrKey: string | string[]): Promise<void> {
  const client = getS3Client();
  const bucketName = process.env.R2_BUCKET_NAME;
  if (!bucketName) {
    return;
  }

  const items = Array.isArray(urlOrKey) ? urlOrKey : [urlOrKey];
  const keys = items.map(normalizeKey).filter(Boolean);

  if (keys.length === 0) return;

  if (keys.length === 1) {
    await client.send(
      new DeleteObjectCommand({
        Bucket: bucketName,
        Key: keys[0],
      })
    );
  } else {
    await client.send(
      new DeleteObjectsCommand({
        Bucket: bucketName,
        Delete: {
          Objects: keys.map((Key) => ({ Key })),
        },
      })
    );
  }
}
