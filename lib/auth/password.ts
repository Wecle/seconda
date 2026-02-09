import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SALT_BYTES = 16;
const KEY_BYTES = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_BYTES).toString("hex");
  const hash = scryptSync(password, salt, KEY_BYTES).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, passwordHash: string): boolean {
  const [salt, storedHash] = passwordHash.split(":");
  if (!salt || !storedHash) {
    return false;
  }

  const derivedHash = scryptSync(password, salt, KEY_BYTES).toString("hex");
  const storedBuffer = Buffer.from(storedHash, "hex");
  const derivedBuffer = Buffer.from(derivedHash, "hex");

  if (storedBuffer.length !== derivedBuffer.length) {
    return false;
  }

  return timingSafeEqual(storedBuffer, derivedBuffer);
}
