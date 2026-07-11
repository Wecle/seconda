import { NextResponse } from "next/server";

export function legacyInterviewReadOnlyResponse() {
  return NextResponse.json(
    { error: "Legacy interviews are read-only after the Agent migration" },
    { status: 410 },
  );
}
