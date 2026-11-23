import type { InboundMessage } from "@ravyn/channels";

/**
 * Trabajo de la cola `inbound`. Lleva el mensaje normalizado (con su texto: es la única forma de
 * pasarlo al pipeline) y los agentes suscritos a su JID. Las fechas viajan en ISO.
 */
export interface InboundJobData {
  agentConfigIds: string[];
  message: SerializedInboundMessage;
}

export type SerializedInboundMessage = Omit<InboundMessage, "waTimestamp" | "receivedAt"> & {
  waTimestamp: string;
  receivedAt: string;
};

export function serializeInbound(m: InboundMessage): SerializedInboundMessage {
  return { ...m, waTimestamp: m.waTimestamp.toISOString(), receivedAt: m.receivedAt.toISOString() };
}

export function deserializeInbound(m: SerializedInboundMessage): InboundMessage {
  return { ...m, waTimestamp: new Date(m.waTimestamp), receivedAt: new Date(m.receivedAt) };
}

/** Id del trabajo: también deduplica dentro de la retención de BullMQ. */
export function inboundJobId(channelId: string, externalId: string): string {
  // BullMQ no acepta ":" en ids personalizados.
  return `${channelId}_${externalId}`;
}
