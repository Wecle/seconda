import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  interviews,
  interviewShares,
  resumes,
  resumeVersions,
} from "@/lib/db/schema";
import { getCurrentUserId } from "@/lib/auth/session";
import { generateInterviewShareToken } from "@/lib/interview/share-token";

const shareExpiryOptions = [24, 72, 168, 720] as const;
const defaultExpiryHours = 168;

async function getUserOwnedInterview(interviewId: string, userId: string) {
  const [interviewRow] = await db
    .select({ interview: interviews })
    .from(interviews)
    .innerJoin(resumeVersions, eq(resumeVersions.id, interviews.resumeVersionId))
    .innerJoin(resumes, eq(resumes.id, resumeVersions.resumeId))
    .where(and(eq(interviews.id, interviewId), eq(resumes.userId, userId)));

  return interviewRow?.interview ?? null;
}

function buildShareUrl(params: {
  origin: string;
  interviewId: string;
  token: string;
}) {
  const { origin, interviewId, token } = params;
  return `${origin}/share/interviews/${interviewId}?token=${encodeURIComponent(token)}`;
}

function buildShareState(params: {
  now: Date;
  interviewId: string;
  origin: string;
  share:
    | {
        nonce: string;
        expiresAt: Date;
        revokedAt: Date | null;
      }
    | null;
}) {
  const { now, interviewId, origin, share } = params;
  if (!share) {
    return {
      status: "none" as const,
      isActive: false,
      expiresAt: null,
      shareUrl: null,
    };
  }

  if (share.revokedAt) {
    return {
      status: "revoked" as const,
      isActive: false,
      expiresAt: share.expiresAt.toISOString(),
      shareUrl: null,
    };
  }

  if (share.expiresAt.getTime() <= now.getTime()) {
    return {
      status: "expired" as const,
      isActive: false,
      expiresAt: share.expiresAt.toISOString(),
      shareUrl: null,
    };
  }

  const token = generateInterviewShareToken({
    interviewId,
    nonce: share.nonce,
  });
  if (!token) {
    return {
      status: "none" as const,
      isActive: false,
      expiresAt: share.expiresAt.toISOString(),
      shareUrl: null,
    };
  }

  return {
    status: "active" as const,
    isActive: true,
    expiresAt: share.expiresAt.toISOString(),
    shareUrl: buildShareUrl({
      origin,
      interviewId,
      token,
    }),
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const interview = await getUserOwnedInterview(id, userId);
    if (!interview) {
      return NextResponse.json({ error: "Interview not found" }, { status: 404 });
    }

    const [share] = await db
      .select({
        nonce: interviewShares.nonce,
        expiresAt: interviewShares.expiresAt,
        revokedAt: interviewShares.revokedAt,
      })
      .from(interviewShares)
      .where(eq(interviewShares.interviewId, id));

    return NextResponse.json(
      buildShareState({
        now: new Date(),
        interviewId: id,
        origin: request.nextUrl.origin,
        share: share ?? null,
      }),
    );
  } catch (error) {
    console.error("Error fetching share state:", error);
    return NextResponse.json(
      { error: "Failed to fetch share state" },
      { status: 500 },
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const interview = await getUserOwnedInterview(id, userId);
    if (!interview) {
      return NextResponse.json({ error: "Interview not found" }, { status: 404 });
    }
    if (!interview.reportJson) {
      return NextResponse.json({ error: "Report is not ready yet" }, { status: 400 });
    }

    let expiresInHours = defaultExpiryHours;
    const body = (await request.json().catch(() => ({}))) as {
      expiresInHours?: number;
    };
    if (typeof body.expiresInHours === "number") {
      expiresInHours = body.expiresInHours;
    }
    if (!shareExpiryOptions.includes(expiresInHours as (typeof shareExpiryOptions)[number])) {
      return NextResponse.json(
        { error: "Invalid expiresInHours option" },
        { status: 400 },
      );
    }

    const nonce = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + expiresInHours * 60 * 60 * 1000);

    await db
      .insert(interviewShares)
      .values({
        interviewId: id,
        nonce,
        expiresAt,
        revokedAt: null,
      })
      .onConflictDoUpdate({
        target: interviewShares.interviewId,
        set: {
          nonce,
          expiresAt,
          revokedAt: null,
          updatedAt: now,
        },
      });

    const token = generateInterviewShareToken({ interviewId: id, nonce });
    if (!token) {
      return NextResponse.json(
        { error: "Share secret is not configured" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      status: "active" as const,
      isActive: true,
      expiresAt: expiresAt.toISOString(),
      shareUrl: buildShareUrl({
        origin: request.nextUrl.origin,
        interviewId: id,
        token,
      }),
    });
  } catch (error) {
    console.error("Error generating share link:", error);
    return NextResponse.json(
      { error: "Failed to generate share link" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const interview = await getUserOwnedInterview(id, userId);
    if (!interview) {
      return NextResponse.json({ error: "Interview not found" }, { status: 404 });
    }

    const now = new Date();
    await db
      .update(interviewShares)
      .set({ revokedAt: now, updatedAt: now })
      .where(eq(interviewShares.interviewId, id));

    return NextResponse.json({
      status: "revoked" as const,
      isActive: false,
      shareUrl: null,
    });
  } catch (error) {
    console.error("Error revoking share link:", error);
    return NextResponse.json(
      { error: "Failed to revoke share link" },
      { status: 500 },
    );
  }
}
