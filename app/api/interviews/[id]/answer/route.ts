import { legacyInterviewReadOnlyResponse } from "@/lib/interview/legacy";

export async function POST() {
  return legacyInterviewReadOnlyResponse();
}
