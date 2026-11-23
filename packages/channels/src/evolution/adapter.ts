import { createHash, timingSafeEqual } from "node:crypto";
import { lidFromJid, normalizePhone, parseJid, phoneSendVariants } from "../phone";
import { validateSendInput } from "../send";
import {
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
import { EvolutionClient, isInstanceAlreadyExists, type EvolutionClientOptions } from "./client";
import { mapConnectionState, parseEvolutionWebhook } from "./parse";
import type { LidLookup } from "./sender";

/**
 * Adaptador de Evolution API v2 (plan, 5.3 a 5.5).
 *
 * Evolution no firma sus webhooks: la autenticación principal es el token de la ruta
 * (`/webhooks/evolution/:channelId/:token`, T1.8). Además, al crear la sesión se pide a
 * Evolution que mande `WEBHOOK_TOKEN_HEADER` con el secreto del canal, y `verifyWebhook`
 * lo comprueba (defensa en profundidad; T1.6 confirma que la versión fijada lo envía).
 */

export const EVOLUTION_CAPABILITIES: ReadonlySet<ChannelCapability> = new Set([
  "read_groups",
  "send_direct",
  "send_group",
  "typing_indicator",
  "qr_pairing",
  "code_pairing",
  "free_form_outside_24h",
]);

/** Únicos eventos que se suscriben (5.3): ni contactos, ni chats, ni actualizaciones. */
export const EVOLUTION_WEBHOOK_EVENTS = [
  "MESSAGES_UPSERT",
  "CONNECTION_UPDATE",
  "QRCODE_UPDATED",
] as const;

/** Ajustes de instancia de 5.3. */
export const EVOLUTION_INSTANCE_SETTINGS = {
  rejectCall: false,
  groupsIgnore: false,
  alwaysOnline: false,
  readMessages: false,
  readStatus: false,
  syncFullHistory: false,
} as const;

export const WEBHOOK_TOKEN_HEADER = "x-ravyn-webhook-token";

export interface EvolutionAdapterOptions {
  client: EvolutionClient | EvolutionClientOptions;
  channelId: string;
  tenantId: string;
  /** `channels.external_instance`. */
  instance: string;
  /** Secreto que Evolution manda en `WEBHOOK_TOKEN_HEADER` (si se configura). */
  webhookSecret?: string;
  lidLookup?: LidLookup;
  now?: () => Date;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

export class EvolutionAdapter implements ChannelAdapter {
  readonly provider = "evolution" as const;
  readonly capabilities = EVOLUTION_CAPABILITIES;
  readonly instance: string;

  private readonly client: EvolutionClient;
  private readonly channelId: string;
  private readonly tenantId: string;
  private readonly webhookSecret: string | undefined;
  private readonly lidLookup: LidLookup | undefined;
  private readonly now: () => Date;

  constructor(opts: EvolutionAdapterOptions) {
    this.client =
      opts.client instanceof EvolutionClient ? opts.client : new EvolutionClient(opts.client);
    this.channelId = opts.channelId;
    this.tenantId = opts.tenantId;
    this.instance = opts.instance;
    this.webhookSecret = opts.webhookSecret;
    this.lidLookup = opts.lidLookup;
    this.now = opts.now ?? (() => new Date());
  }

  private get path() {
    return encodeURIComponent(this.instance);
  }

  // Entrada

  parseWebhook(raw: unknown, _headers: Record<string, string>): ChannelEvent[] {
    return parseEvolutionWebhook(raw, {
      channelId: this.channelId,
      tenantId: this.tenantId,
      instance: this.instance,
      now: this.now,
      lidLookup: this.lidLookup,
    });
  }

  verifyWebhook(_raw: Buffer, headers: Record<string, string>, secret: string): boolean {
    const received = headers[WEBHOOK_TOKEN_HEADER];
    if (!received || !secret) return false;
    // Se comparan los hashes para que la comparación sea de longitud fija.
    const a = createHash("sha256").update(received).digest();
    const b = createHash("sha256").update(secret).digest();
    return timingSafeEqual(a, b);
  }

  // Salida

  /**
   * `POST /message/sendText/{instance}` con `delay` (WhatsApp muestra "escribiendo..." ese
   * tiempo) y sin vista previa de enlaces. Para un teléfono mexicano, si el número con `1` no
   * existe, se prueba sin él (5.2). Evolution no tiene idempotencia: la garantiza el motor con
   * `outbound_messages`.
   */
  async sendText(input: SendTextInput): Promise<SendTextResult> {
    validateSendInput(input, this.provider);
    const candidates = this.destinations(input.to);
    const delay = Math.round(input.typingMs ?? 0);

    let lastError: unknown;
    for (const number of candidates) {
      try {
        const res = await this.client.request({
          method: "POST",
          path: `/message/sendText/${this.path}`,
          op: "sendText",
          body: { number, text: input.text, delay, linkPreview: false },
          // Evolution responde después del delay.
          extraTimeoutMs: delay,
        });
        const id =
          isObj(res) && isObj(res.key) && typeof res.key.id === "string" ? res.key.id : null;
        if (!id) {
          throw new ChannelError("provider_error", "Evolution sendText: respuesta sin key.id", {
            provider: this.provider,
          });
        }
        return { providerMessageId: id };
      } catch (err) {
        lastError = err;
        if (!(err instanceof ChannelError && err.code === "number_not_found")) throw err;
      }
    }
    throw lastError;
  }

  /** Destinos en el formato de Evolution, en orden de intento. */
  private destinations(to: SendTextInput["to"]): string[] {
    const invalid = () =>
      new ChannelError("invalid_input", "sendText: destino inválido", { provider: this.provider });

    if (to.phone !== undefined) {
      const phone = normalizePhone(to.phone);
      if (!phone) throw invalid();
      return phoneSendVariants(phone);
    }
    const jid = to.jid ?? "";
    const parsed = parseJid(jid);
    if (parsed.kind === "user") {
      const phone = normalizePhone(jid);
      if (!phone) throw invalid();
      return phoneSendVariants(phone);
    }
    if (parsed.kind === "lid") {
      const lid = lidFromJid(jid);
      if (!lid) throw invalid();
      return [`${lid}@lid`];
    }
    if (parsed.kind === "group") return [jid];
    throw invalid();
  }

  // Ciclo de vida

  /**
   * Crea la instancia (o reutiliza la existente), configura el webhook por instancia y aplica
   * los ajustes de 5.3. Es idempotente: se puede volver a llamar para corregir la configuración.
   */
  async createSession(opts: { instance: string; webhookUrl: string }): Promise<void> {
    if (opts.instance !== this.instance) {
      throw new ChannelError("invalid_input", "createSession: instancia distinta a la del canal", {
        provider: this.provider,
      });
    }
    try {
      await this.client.request({
        method: "POST",
        path: "/instance/create",
        op: "createInstance",
        body: { instanceName: this.instance, integration: "WHATSAPP-BAILEYS", qrcode: false },
      });
    } catch (err) {
      if (!isInstanceAlreadyExists(err)) throw err;
    }

    const webhook: Obj = {
      enabled: true,
      url: opts.webhookUrl,
      byEvents: false,
      base64: false,
      events: [...EVOLUTION_WEBHOOK_EVENTS],
    };
    if (this.webhookSecret) webhook.headers = { [WEBHOOK_TOKEN_HEADER]: this.webhookSecret };
    await this.client.request({
      method: "POST",
      path: `/webhook/set/${this.path}`,
      op: "setWebhook",
      body: { webhook },
    });

    await this.client.request({
      method: "POST",
      path: `/settings/set/${this.path}`,
      op: "setSettings",
      body: { ...EVOLUTION_INSTANCE_SETTINGS },
    });
  }

  /**
   * `GET /instance/connect/{instance}`. Con `pairingPhone`, Evolution devuelve además el código
   * de vinculación para escribirlo en el teléfono (5.5); el QR queda como alternativa.
   */
  async connect(opts: { pairingPhone?: string }): Promise<PairingResult> {
    let number: string | undefined;
    if (opts.pairingPhone !== undefined) {
      const phone = normalizePhone(opts.pairingPhone, { defaultCountry: "MX" });
      if (!phone) {
        throw new ChannelError("invalid_input", "connect: teléfono de vinculación inválido", {
          provider: this.provider,
        });
      }
      number = phone;
    }
    const res = await this.client.request({
      method: "GET",
      path: `/instance/connect/${this.path}`,
      op: "connect",
      query: { number },
    });
    const o = isObj(res) ? res : {};
    const qr =
      (typeof o.base64 === "string" && o.base64) || (typeof o.code === "string" && o.code) || null;
    const pairingCode = typeof o.pairingCode === "string" && o.pairingCode ? o.pairingCode : null;
    return { qr, pairingCode };
  }

  async getStatus(): Promise<ChannelStatus> {
    const res = await this.client.request({
      method: "GET",
      path: `/instance/connectionState/${this.path}`,
      op: "connectionState",
    });
    const state = isObj(res) ? (isObj(res.instance) ? res.instance.state : res.state) : undefined;
    return mapConnectionState(state) ?? "error";
  }

  async restart(): Promise<void> {
    await this.client.request({
      method: "POST",
      path: `/instance/restart/${this.path}`,
      op: "restart",
    });
  }

  async logout(): Promise<void> {
    await this.client.request({
      method: "DELETE",
      path: `/instance/logout/${this.path}`,
      op: "logout",
    });
  }

  // Grupos

  async listGroups(): Promise<GroupSummary[]> {
    const res = await this.client.request({
      method: "GET",
      path: `/group/fetchAllGroups/${this.path}`,
      op: "fetchAllGroups",
      query: { getParticipants: false },
    });
    if (!Array.isArray(res)) return [];
    return res.filter(isObj).flatMap((g) => {
      const jid = typeof g.id === "string" ? g.id : null;
      if (!jid || parseJid(jid).kind !== "group") return [];
      const size =
        typeof g.size === "number"
          ? g.size
          : Array.isArray(g.participants)
            ? g.participants.length
            : 0;
      return [{ jid, subject: typeof g.subject === "string" ? g.subject : "", size }];
    });
  }

  async getGroupParticipants(jid: string): Promise<GroupParticipant[]> {
    if (parseJid(jid).kind !== "group") {
      throw new ChannelError("invalid_input", "JID de grupo inválido", { provider: this.provider });
    }
    const res = await this.client.request({
      method: "GET",
      path: `/group/participants/${this.path}`,
      op: "groupParticipants",
      query: { groupJid: jid },
    });
    const list = Array.isArray(res)
      ? res
      : isObj(res) && Array.isArray(res.participants)
        ? res.participants
        : [];
    return list.filter(isObj).flatMap((p) => {
      const id = typeof p.id === "string" ? p.id : null;
      if (!id) return [];
      // Según la versión, el teléfono y el LID vienen en `id`, `jid`, `phoneNumber` o `lid`.
      const candidates = [p.id, p.jid, p.phoneNumber, p.lid].filter(
        (v): v is string => typeof v === "string",
      );
      const phone = candidates.map((c) => normalizePhone(c)).find((v) => v !== null) ?? null;
      const lid = candidates.map((c) => lidFromJid(c)).find((v) => v !== null) ?? null;
      return [{ jid: id, phone, lid }];
    });
  }
}
