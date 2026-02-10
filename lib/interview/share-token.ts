import { createHmac, timingSafeEqual } from "node:crypto";

const shareTokenVersion = "v1";

function getShareSecret() {
  return process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || null;
}

function signPayload(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function generateInterviewShareToken(params: {
  interviewId: string;
  nonce: string;
}) {
  const { interviewId, nonce } = params;
  const secret = getShareSecret();
  if (!secret) return null;

  const signature = signPayload(
    `${shareTokenVersion}:${interviewId}:${nonce}`,
    secret,
  );
  return `${nonce}.${signature}`;
}

export function verifyInterviewShareToken(params: {
  interviewId: string;
  nonce: string;
  token: string | null | undefined;
}) {
  const { interviewId, nonce, token } = params;
  if (!token) return false;

  const [tokenNonce, tokenSignature] = token.split(".");
  if (!tokenNonce || !tokenSignature || tokenNonce !== nonce) return false;

  const expected = generateInterviewShareToken({ interviewId, nonce });
  if (!expected) return false;

  const tokenBuffer = Buffer.from(token);
  const expectedBuffer = Buffer.from(expected);
  if (tokenBuffer.length !== expectedBuffer.length) return false;

  return timingSafeEqual(tokenBuffer, expectedBuffer);
}
