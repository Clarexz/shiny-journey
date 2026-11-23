/**
 * Interfaz común de los canales de mensajería (plan, sección 5.1).
 *
 * El núcleo y los módulos solo ven `ChannelAdapter`, `InboundMessage` y `ChannelCapability`.
 * El proveedor concreto (Evolution, Meta Cloud o Fake) queda detrás de esta interfaz.
 */

export const PROVIDERS = ["evolution", "meta_cloud", "fake"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const CHANNEL_CAPABILITIES = [
  "read_groups",
  "send_direct",
  "send_group",
  "typing_indicator",
  "qr_pairing",
  "code_pairing",
  "free_form_outside_24h",
] as const;
export type ChannelCapability = (typeof CHANNEL_CAPABILITIES)[number];

/** Mismos valores que el CHECK `channels_status_check` de la base. */
export const CHANNEL_STATUSES = [
  "pending_qr",
  "connecting",
  "open",
  "closed",
  "logged_out",
  "error",
] as const;
export type ChannelStatus = (typeof CHANNEL_STATUSES)[number];

export type InboundMessageType = "text" | "media" | "reaction" | "system" | "other";

export interface InboundMessage {
  provider: Provider;
  channelId: string;
  tenantId: string;
  /** Identificador del mensaje en el proveedor (`key.id` en Evolution). */
  externalId: string;
  chat: { jid: string; kind: "group" | "direct" };
  sender: {
    /** Tal cual llegó: `521...@s.whatsapp.net` o `1234@lid`. */
    jid: string;
    /** Normalizado (`521XXXXXXXXXX`), si se conoce. */
    phone: string | null;
    /** Sin sufijo `@lid`. */
    lid: string | null;
    /** `pushName`. */
    name: string | null;
  };
  fromMe: boolean;
  type: InboundMessageType;
  /** `conversation`, `extendedTextMessage.text` o `caption`. */
  text: string | null;
  /** `messageTimestamp` (resolución de segundos). */
  waTimestamp: Date;
  /** Momento en que llegó el webhook, para medir latencia. */
  receivedAt: Date;
}

export type ChannelEvent =
  | { kind: "message"; message: InboundMessage }
  | { kind: "connection"; status: ChannelStatus; detail?: Record<string, unknown> }
  | { kind: "qr"; qr: string | null; pairingCode: string | null }
  | { kind: "ignored"; reason: string };

export interface SendTextInput {
  /** Uno de los dos. */
  to: { jid?: string; phone?: string };
  text: string;
  /** "Escribiendo..." antes de enviar. */
  typingMs?: number;
  idempotencyKey: string;
}

export interface SendTextResult {
  providerMessageId: string;
}

export interface GroupSummary {
  jid: string;
  subject: string;
  size: number;
}

export interface GroupParticipant {
  jid: string;
  phone: string | null;
  lid: string | null;
}

export interface PairingResult {
  qr: string | null;
  pairingCode: string | null;
}

export interface ChannelAdapter {
  readonly provider: Provider;
  readonly capabilities: ReadonlySet<ChannelCapability>;

  /** Entrada: convierte un payload crudo en eventos normalizados, sin efectos secundarios. */
  parseWebhook(raw: unknown, headers: Record<string, string>): ChannelEvent[];
  verifyWebhook(raw: Buffer, headers: Record<string, string>, secret: string): boolean;

  /** Salida. */
  sendText(input: SendTextInput): Promise<SendTextResult>;

  /** Ciclo de vida de la sesión. */
  createSession(opts: { instance: string; webhookUrl: string }): Promise<void>;
  connect(opts: { pairingPhone?: string }): Promise<PairingResult>;
  getStatus(): Promise<ChannelStatus>;
  restart(): Promise<void>;
  logout(): Promise<void>;

  /** Metadatos de grupos (para elegir el grupo objetivo y resolver LID). */
  listGroups(): Promise<GroupSummary[]>;
  getGroupParticipants(jid: string): Promise<GroupParticipant[]>;
}

/**
 * Lo que el registro necesita de una fila de `channels` para construir el adaptador.
 * `provider` es `text` en la base: se valida al construir.
 */
export interface ChannelRow {
  id: string;
  tenant_id: string;
  provider: string;
  external_instance: string;
  phone: string | null;
  status: string;
  settings: unknown;
}

export const CHANNEL_ERROR_CODES = [
  /** El proveedor no respondió a tiempo. */
  "timeout",
  /** No se pudo conectar con el proveedor. */
  "network",
  /** Credenciales del proveedor inválidas. */
  "unauthorized",
  /** La instancia o el recurso no existe. */
  "not_found",
  /** El destinatario no tiene WhatsApp (permite probar la variante sin el `1`). */
  "number_not_found",
  /** La sesión no está abierta. */
  "not_connected",
  "rate_limited",
  /** Datos de entrada inválidos (destino vacío, proveedor desconocido, etc.). */
  "invalid_input",
  /** El canal no tiene la capacidad que se pidió. */
  "unsupported",
  "not_implemented",
  /** Cualquier otra respuesta de error del proveedor. */
  "provider_error",
] as const;
export type ChannelErrorCode = (typeof CHANNEL_ERROR_CODES)[number];

/**
 * Error de canal con código estable. Los adaptadores convierten cualquier falla del proveedor
 * en un `ChannelError`, para que el motor decida (reintentar, notificar, etc.) sin conocer
 * al proveedor. El mensaje nunca incluye texto de mensajes ni números completos.
 */
export class ChannelError extends Error {
  override name = "ChannelError";
  readonly code: ChannelErrorCode;
  readonly provider: Provider | null;
  /** Código HTTP del proveedor, si lo hubo. */
  readonly status: number | null;
  readonly retryable: boolean;

  constructor(
    code: ChannelErrorCode,
    message: string,
    opts: {
      provider?: Provider | null;
      status?: number | null;
      retryable?: boolean;
      cause?: unknown;
    } = {},
  ) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.code = code;
    this.provider = opts.provider ?? null;
    this.status = opts.status ?? null;
    this.retryable = opts.retryable ?? (code === "timeout" || code === "network");
  }
}

export class NotImplementedError extends ChannelError {
  override name = "NotImplementedError";

  constructor(what: string, provider: Provider | null = null) {
    super("not_implemented", what, { provider, retryable: false });
  }
}

export function isChannelError(err: unknown): err is ChannelError {
  return err instanceof ChannelError;
}

export function isProvider(value: unknown): value is Provider {
  return typeof value === "string" && (PROVIDERS as readonly string[]).includes(value);
}

export function isChannelStatus(value: unknown): value is ChannelStatus {
  return typeof value === "string" && (CHANNEL_STATUSES as readonly string[]).includes(value);
}
