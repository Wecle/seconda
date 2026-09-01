function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: 50000,
      hash: "SHA-256",
    },
    keyMaterial,
    256,
  );
  const saltHex = bytesToHex(salt);
  const hashHex = bytesToHex(new Uint8Array(derivedBits));
  return `pbkdf2:${saltHex}:${hashHex}`;
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  if (!passwordHash) return false;

  if (passwordHash.startsWith("pbkdf2:")) {
    const parts = passwordHash.split(":");
    if (parts.length !== 3) return false;
    const [, saltHex, storedHashHex] = parts;
    const salt = hexToBytes(saltHex);
    const storedBytes = hexToBytes(storedHashHex);

    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveBits"],
    );
    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt,
        iterations: 50000,
        hash: "SHA-256",
      },
      keyMaterial,
      256,
    );
    return constantTimeEqual(storedBytes, new Uint8Array(derivedBits));
  }

  try {
    const { scryptSync } = await import("node:crypto");
    const [salt, storedHash] = passwordHash.split(":");
    if (!salt || !storedHash) return false;
    const derivedHash = scryptSync(password, salt, 64).toString("hex");
    return derivedHash === storedHash;
  } catch {
    return false;
  }
}
