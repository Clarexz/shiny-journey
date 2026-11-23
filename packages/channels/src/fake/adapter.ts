import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { isGroupJid, lidFromJid, normalizePhone } from "../phone";
import { validateSendInput } from "../send";
import {
  CHANNEL_CAPABILITIES,
  CHANNEL_STATUSES,
  ChannelError,
  type ChannelAdapter,
  type ChannelCapability,
  type ChannelEvent,
  type ChannelStatus,
  type GroupParticipant,
  type GroupSummary,
  type PairingResult,
  type SendTextInput,
  type SendTextResult,
} from "../types";

/**
 * Adaptador Fake (plan, 5.7): para pruebas, el harness de webhooks y el modo dry-run.
 *
 * - `parseWebhook` acepta el formato normalizado (ver `FakeWebhookPayload`).
 * - `sendText` registra el envío en memoria (`FakeOutbox`), con una latencia configurable.
 * - El ciclo de vida de la sesión se simula en memoria.
 */

/** Encabezado con la firma de un webhook Fake: `sha256=<hex>` (HMAC-SHA256 del cuerpo). */
export const FAKE_SIGNATURE_HEADER = "x-fake-signature";

const timestampSchema = z.union([
  // Segundos desde epoch, como `messageTimestamp` de Evolution.
  z.number().int().nonnegative(),
  z.iso.datetime({ offset: true }),
]);

const fakeMessageSchema = z.object({
  externalId: z.string().min(1),
  chat: z.object({
    jid: z.string().min(1),
    kind: z.enum(["group", "direct"]).optional(),
  }),
  sender: z.object({
    jid: z.string().min(1),
    /** Teléfono explícito, para simular un `@lid` con campo alterno. */
    phone: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
  }),
  fromMe: z.boolean().optional(),
  type: z.enum(["text", "media", "reaction", "system", "other"]).optional(),
  text: z.string().nullable().optional(),
  waTimestamp: timestampSchema.optional(),
});

const fakeEventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("message"), message: fakeMessageSchema }),
  z.object({
    kind: z.literal("connection"),
    status: z.enum(CHANNEL_STATUSES),
    detail: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    kind: z.literal("qr"),
    qr: z.string().nullable(),
    pairingCode: z.string().nullable(),
  }),
]);

const fakePayloadSchema = z.union([
  fakeEventSchema,
  z.object({ events: z.array(fakeEventSchema).min(1) }),
]);

export type FakeWebhookEvent = z.input<typeof fakeEventSchema>;
export type FakeWebhookPayload = z.input<typeof fakePayloadSchema>;

export interface FakeSentMessage {
  channelId: string;
  providerMessageId: string;
  idempotencyKey: string;
  to: { jid?: string; phone?: string };
  text: string;
  typingMs: number;
  sentAt: Date;
}

/**
 * Registro en memoria de los envíos. Se puede compartir entre adaptadores (el modo dry-run
 * usa uno solo para todos los canales del proceso).
 */
export class FakeOutbox {
  readonly sent: FakeSentMessage[] = [];
  private readonly byKey = new Map<string, FakeSentMessage>();

  /** Devuelve el envío previo con la misma clave de idempotencia en el canal, si lo hay. */
  find(channelId: string, idempotencyKey: string): FakeSentMessage | undefined {
    return this.byKey.get(`${channelId}\u0000${idempotencyKey}`);
  }

  record(message: FakeSentMessage): void {
    this.sent.push(message);
    this.byKey.set(`${message.channelId}\u0000${message.idempotencyKey}`, message);
  }

  forChannel(channelId: string): FakeSentMessage[] {
    return this.sent.filter((m) => m.channelId === channelId);
  }

  clear(): void {
    this.sent.length = 0;
    this.byKey.clear();
  }
}

export interface FakeAdapterOptions {
  channelId: string;
  tenantId: string;
  instance?: string;
  status?: ChannelStatus;
  capabilities?: Iterable<ChannelCapability>;
  outbox?: FakeOutbox;
  /** Latencia simulada de `sendText`, en ms (por defecto 0). */
  sendLatencyMs?: number;
  /**
   * Si es `true`, `sendText` también espera `typingMs`, como haría WhatsApp con el
   * "escribiendo...". Por defecto `false`, para que las pruebas no esperen.
   */
  honorTypingDelay?: boolean;
  groups?: GroupSummary[];
  participants?: Record<string, GroupParticipant[]>;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) =>
  ms > 0 ? new Promise<void>((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

/** Calcula la firma que espera `FakeAdapter.verifyWebhook` (para el harness y las pruebas). */
export function signFakeWebhook(raw: Buffer | string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
}

export class FakeAdapter implements ChannelAdapter {
  readonly provider = "fake" as const;
  readonly capabilities: ReadonlySet<ChannelCapability>;
  readonly outbox: FakeOutbox;
  readonly channelId: string;
  readonly tenantId: string;

  instance: string | null;
  webhookUrl: string | null = null;
  /** Llamadas al ciclo de vida, para que las pruebas las verifiquen. */
  readonly calls: Array<{ method: string; args?: unknown }> = [];

  private status: ChannelStatus;
  private groups: GroupSummary[];
  private participants: Record<string, GroupParticipant[]>;
  private readonly sendLatencyMs: number;
  private readonly honorTypingDelay: boolean;
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly failures: Array<(input: SendTextInput) => ChannelError | null> = [];
  private seq = 0;

  constructor(opts: FakeAdapterOptions) {
    this.channelId = opts.channelId;
    this.tenantId = opts.tenantId;
    this.instance = opts.instance ?? null;
    this.status = opts.status ?? "open";
    this.capabilities = new Set(opts.capabilities ?? CHANNEL_CAPABILITIES);
    this.outbox = opts.outbox ?? new FakeOutbox();
    this.sendLatencyMs = opts.sendLatencyMs ?? 0;
    this.honorTypingDelay = opts.honorTypingDelay ?? false;
    this.groups = opts.groups ?? [];
    this.participants = opts.participants ?? {};
    this.now = opts.now ?? (() => new Date());
    this.sleep = opts.sleep ?? defaultSleep;
  }

  // Entrada

  parseWebhook(raw: unknown, _headers: Record<string, string>): ChannelEvent[] {
    const parsed = fakePayloadSchema.safeParse(raw);
    if (!parsed.success) return [{ kind: "ignored", reason: "payload_invalido" }];
    const events = "events" in parsed.data ? parsed.data.events : [parsed.data];
    const receivedAt = this.now();
    return events.map((event): ChannelEvent => {
      switch (event.kind) {
        case "message":
          return { kind: "message", message: this.toInbound(event.message, receivedAt) };
        case "connection":
          return event.detail === undefined
            ? { kind: "connection", status: event.status }
            : { kind: "connection", status: event.status, detail: event.detail };
        case "qr":
          return { kind: "qr", qr: event.qr, pairingCode: event.pairingCode };
      }
    });
  }

  verifyWebhook(raw: Buffer, headers: Record<string, string>, secret: string): boolean {
    const received = headers[FAKE_SIGNATURE_HEADER];
    if (!received || !secret) return false;
    const expected = Buffer.from(signFakeWebhook(raw, secret));
    const actual = Buffer.from(received);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  private toInbound(m: z.output<typeof fakeMessageSchema>, receivedAt: Date) {
    const waTimestamp =
      m.waTimestamp === undefined
        ? receivedAt
        : typeof m.waTimestamp === "number"
          ? new Date(m.waTimestamp * 1000)
          : new Date(m.waTimestamp);
    const text = m.text ?? null;
    return {
      provider: this.provider,
      channelId: this.channelId,
      tenantId: this.tenantId,
      externalId: m.externalId,
      chat: { jid: m.chat.jid, kind: m.chat.kind ?? (isGroupJid(m.chat.jid) ? "group" : "direct") },
      sender: {
        jid: m.sender.jid,
        phone: normalizePhone(m.sender.phone ?? m.sender.jid),
        lid: lidFromJid(m.sender.jid),
        name: m.sender.name ?? null,
      },
      fromMe: m.fromMe ?? false,
      type: m.type ?? (text === null ? "other" : "text"),
      text,
      waTimestamp,
      receivedAt,
    } as const;
  }

  // Salida

  async sendText(input: SendTextInput): Promise<SendTextResult> {
    validateSendInput(input, this.provider);
    const previous = this.outbox.find(this.channelId, input.idempotencyKey);
    if (previous) return { providerMessageId: previous.providerMessageId };

    if (this.status !== "open") {
      throw new ChannelError("not_connected", `Canal en estado ${this.status}`, {
        provider: this.provider,
        retryable: true,
      });
    }
    for (const failure of this.failures) {
      const err = failure(input);
      if (err) {
        this.failures.splice(this.failures.indexOf(failure), 1);
        throw err;
      }
    }

    const typingMs = input.typingMs ?? 0;
    await this.sleep(this.sendLatencyMs + (this.honorTypingDelay ? typingMs : 0));

    const message: FakeSentMessage = {
      channelId: this.channelId,
      providerMessageId: `fake-${this.channelId}-${++this.seq}`,
      idempotencyKey: input.idempotencyKey,
      to: { ...input.to },
      text: input.text,
      typingMs,
      sentAt: this.now(),
    };
    this.outbox.record(message);
    return { providerMessageId: message.providerMessageId };
  }

  /**
   * Hace fallar el siguiente envío que cumpla `match` (por defecto, el siguiente) con `error`.
   * Sirve para probar reintentos, la variante sin el `1` y el paso a NOTIFICAR.
   */
  failNextSend(error: ChannelError, match: (input: SendTextInput) => boolean = () => true): void {
    this.failures.push((input) => (match(input) ? error : null));
  }

  // Ciclo de vida

  async createSession(opts: { instance: string; webhookUrl: string }): Promise<void> {
    this.calls.push({ method: "createSession", args: opts });
    this.instance = opts.instance;
    this.webhookUrl = opts.webhookUrl;
    this.status = "pending_qr";
  }

  async connect(opts: { pairingPhone?: string }): Promise<PairingResult> {
    this.calls.push({ method: "connect", args: opts });
    if (opts.pairingPhone !== undefined) {
      if (normalizePhone(opts.pairingPhone) === null) {
        throw new ChannelError("invalid_input", "Teléfono de vinculación inválido", {
          provider: this.provider,
        });
      }
      this.status = "connecting";
      return { qr: null, pairingCode: "FAKE-1234" };
    }
    this.status = "pending_qr";
    return { qr: "fake-qr", pairingCode: null };
  }

  async getStatus(): Promise<ChannelStatus> {
    return this.status;
  }

  async restart(): Promise<void> {
    this.calls.push({ method: "restart" });
    if (this.status !== "logged_out") this.status = "open";
  }

  async logout(): Promise<void> {
    this.calls.push({ method: "logout" });
    this.status = "logged_out";
  }

  /** Cambia el estado simulado (por ejemplo, para probar una desconexión). */
  setStatus(status: ChannelStatus): void {
    this.status = status;
  }

  // Grupos

  async listGroups(): Promise<GroupSummary[]> {
    return this.groups.map((g) => ({ ...g }));
  }

  async getGroupParticipants(jid: string): Promise<GroupParticipant[]> {
    if (!isGroupJid(jid)) {
      throw new ChannelError("invalid_input", "JID de grupo inválido", { provider: this.provider });
    }
    const participants = this.participants[jid];
    if (!participants) {
      throw new ChannelError("not_found", "Grupo no encontrado", { provider: this.provider });
    }
    return participants.map((p) => ({ ...p }));
  }

  setGroups(groups: GroupSummary[], participants: Record<string, GroupParticipant[]> = {}): void {
    this.groups = groups;
    this.participants = participants;
  }
}
