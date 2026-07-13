import {
  publicRoomEventEnvelopeSchema,
  type PublicRoomEventEnvelope,
} from "./contracts";

export function serializePublicRoomEvents(rows: Array<{
  id: string;
  runId: string;
  sequence: number;
  type: string;
  visibility: string;
  attemptId: string | null;
  logicalMessageId: string | null;
  payload: unknown;
  createdAt: Date | string;
}>): PublicRoomEventEnvelope[] {
  return rows.map((row) => publicRoomEventEnvelopeSchema.parse({
    ...row,
    createdAt: row.createdAt instanceof Date
      ? row.createdAt.toISOString()
      : row.createdAt,
  }));
}
