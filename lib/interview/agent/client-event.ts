import { z } from "zod";
import {
  agentStreamEventSchema,
  publicAgentEventPayloadSchemas,
  publicAgentEventTypeSchema,
  type PublicAgentEventType,
} from "./contracts";

type PublicAgentEventPayloads = {
  [Type in PublicAgentEventType]: z.output<(typeof publicAgentEventPayloadSchemas)[Type]>;
};

export type AgentRunStreamEvent = {
  [Type in PublicAgentEventType]: {
    type: Type;
    sequence: number;
    payload: PublicAgentEventPayloads[Type];
  };
}[PublicAgentEventType];

type EventMessage = Pick<MessageEvent<string>, "data" | "lastEventId">;

export function parseAgentRunStreamEvent(type: string, message: EventMessage): AgentRunStreamEvent | null {
  const sequence = Number(message.lastEventId);
  if (!Number.isInteger(sequence) || sequence <= 0) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(message.data) as unknown;
  } catch {
    return null;
  }

  const envelope = agentStreamEventSchema.safeParse({ type, sequence, payload });
  if (!envelope.success || envelope.data.type === "heartbeat") return null;

  const publicType = publicAgentEventTypeSchema.safeParse(envelope.data.type);
  if (!publicType.success) return null;
  const parsedPayload = publicAgentEventPayloadSchemas[publicType.data].safeParse(envelope.data.payload);
  if (!parsedPayload.success) return null;

  return {
    type: publicType.data,
    sequence,
    payload: parsedPayload.data,
  } as AgentRunStreamEvent;
}
