import pg from "pg";
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it } from "vitest";

/**
 * Pruebas SQL de las migraciones de T1.9 (motor y Apartador de turnos). Requieren una base con
 * las migraciones y la semilla aplicadas (Supabase local o CI). Todo corre en una transacción
 * que se revierte.
 */
const DATABASE_URL = process.env.DATABASE_URL;

const TENANT = "00000000-0000-4000-a000-000000000001"; // dr-demo (semilla)
const OWNER = "00000000-0000-4000-b000-000000000001";
const ADMIN = "00000000-0000-4000-b000-000000000002"; // ravyn_admin, sin tenant
const TOKEN_HASH = "0".repeat(64);

describe.skipIf(!DATABASE_URL)("migraciones de T1.9 (integración)", () => {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  let channelId: string;
  let agentConfigId: string;
  let otherAgentConfigId: string;

  const q = (text: string, values?: unknown[]) => client.query(text, values);

  /** Ejecuta en un savepoint y devuelve el error de Postgres (o null si no falló). */
  async function pgError(text: string, values?: unknown[]) {
    await q("savepoint s");
    try {
      await q(text, values);
      await q("release savepoint s");
      return null;
    } catch (e) {
      await q("rollback to savepoint s");
      return e as { code: string; constraint?: string };
    }
  }

  const claim = (over: Record<string, unknown> = {}) => {
    const c = {
      agent_config_id: agentConfigId,
      branch_code: "S-0404",
      branch_number: 3,
      date: "2026-11-09",
      shift: "matutino",
      publisher_jid: "100000000000003@lid",
      status: "dm_sent",
      origin: "auto",
      ...over,
    };
    return pgError(
      `insert into public.mod_turnos_claims
         (tenant_id, agent_config_id, branch_code, branch_number, date, shift, publisher_jid, status, origin)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        TENANT,
        c.agent_config_id,
        c.branch_code,
        c.branch_number,
        c.date,
        c.shift,
        c.publisher_jid,
        c.status,
        c.origin,
      ],
    );
  };

  beforeAll(async () => {
    await client.connect();
  });
  afterAll(async () => {
    await client.end();
  });

  beforeEach(async () => {
    await q("begin");
    const ch = await q(
      `insert into public.channels (tenant_id, provider, external_instance, webhook_token_hash)
       values ($1, 'evolution', 't-prueba-migraciones', $2) returning id`,
      [TENANT, "a".repeat(64)],
    );
    channelId = ch.rows[0].id;
    const ac = await q(
      `insert into public.agent_configs (tenant_id, module_key, channel_id, name, config, schema_version)
       values ($1, 'apartador_turnos', $2, 'Apartador', '{}', '1.0.0') returning id`,
      [TENANT, channelId],
    );
    agentConfigId = ac.rows[0].id;

    // Otro tenant con su propio agente, para las pruebas de aislamiento.
    const t2 = await q(
      `insert into public.tenants (slug, name) values ('otro', 'Otro') returning id`,
    );
    const ch2 = await q(
      `insert into public.channels (tenant_id, provider, external_instance, webhook_token_hash)
       values ($1, 'evolution', 't-otro-1', $2) returning id`,
      [t2.rows[0].id, "b".repeat(64)],
    );
    const ac2 = await q(
      `insert into public.agent_configs (tenant_id, module_key, channel_id, name, config, schema_version)
       values ($1, 'apartador_turnos', $2, 'Apartador', '{}', '1.0.0') returning id`,
      [t2.rows[0].id, ch2.rows[0].id],
    );
    otherAgentConfigId = ac2.rows[0].id;
  });

  afterEach(async () => {
    await q("rollback");
  });

  it("el catálogo tiene las 85 sucursales", async () => {
    const { rows } = await q(
      "select count(*)::int as n, count(distinct number)::int as numbers from public.mod_turnos_branches",
    );
    expect(rows[0]).toEqual({ n: 85, numbers: 52 });
  });

  it("el índice parcial único rechaza dos claims activos el mismo día", async () => {
    expect(await claim()).toBeNull();
    const err = await claim({
      publisher_jid: "100000000000009@lid",
      branch_code: "S-2524",
      branch_number: 38,
    });
    expect(err).toMatchObject({
      code: "23505",
      constraint: "mod_turnos_claims_one_active_per_day",
    });
    // `confirmed` también cuenta como activo.
    expect(await claim({ publisher_jid: "x@lid", status: "confirmed" })).toMatchObject({
      code: "23505",
    });
  });

  it("los claims perdidos o cancelados no bloquean el día", async () => {
    expect(await claim({ status: "lost" })).toBeNull();
    expect(await claim({ publisher_jid: "otro@lid", status: "cancelled" })).toBeNull();
    expect(await claim({ publisher_jid: "tercero@lid" })).toBeNull();
    // Otro día sí se puede.
    expect(await claim({ publisher_jid: "tercero@lid", date: "2026-11-10" })).toBeNull();
  });

  it("no se repite el mismo publicador, día y turno", async () => {
    expect(await claim({ status: "lost" })).toBeNull();
    expect(await claim({ status: "cancelled" })).toMatchObject({
      code: "23505",
      constraint: "mod_turnos_claims_publisher_shift_unique",
    });
  });

  it("las FK compuestas impiden mezclar tenants", async () => {
    // Claim del tenant dr-demo apuntando al agente de otro tenant.
    expect(await claim({ agent_config_id: otherAgentConfigId })).toMatchObject({ code: "23503" });
    const err = await pgError(
      `insert into public.captured_messages
         (tenant_id, channel_id, agent_config_id, external_id, chat_jid, sender_jid, wa_timestamp, received_at)
       values ($1, $2, $3, 'm1', '120363000000000001@g.us', 'x@lid', now(), now())`,
      [TENANT, channelId, otherAgentConfigId],
    );
    expect(err).toMatchObject({ code: "23503" });
  });

  it("push_subscriptions solo acepta usuarios del mismo tenant", async () => {
    const insert = (userId: string) =>
      pgError(
        `insert into public.push_subscriptions (tenant_id, user_id, endpoint, p256dh, auth)
         values ($1, $2, $3, 'k', 'a')`,
        [TENANT, userId, `https://push.example.com/${userId}`],
      );
    expect(await insert(OWNER)).toBeNull();
    expect(await insert(ADMIN)).toMatchObject({ code: "23503" });
  });

  it("agent_events: decisión obligatoria en kind=decision y valores válidos", async () => {
    const ev = (kind: string, decision: string | null) =>
      pgError(
        `insert into public.agent_events (tenant_id, agent_config_id, kind, decision, reasons)
         values ($1, $2, $3, $4, '{cumple}')`,
        [TENANT, agentConfigId, kind, decision],
      );
    expect(await ev("decision", "APARTAR")).toBeNull();
    expect(await ev("decision", null)).toMatchObject({
      constraint: "agent_events_decision_required",
    });
    expect(await ev("decision", "TAL_VEZ")).toMatchObject({
      constraint: "agent_events_decision_check",
    });
    expect(await ev("error", null)).toBeNull();
  });

  it("outbound_messages es idempotente por canal y clave", async () => {
    const send = () =>
      pgError(
        `insert into public.outbound_messages
           (tenant_id, channel_id, idempotency_key, to_jid, template_id, body, origin)
         values ($1, $2, 'ev-1:5218990000002', '5218990000002@s.whatsapp.net', 'interest.1', 'Hola', 'auto')`,
        [TENANT, channelId],
      );
    expect(await send()).toBeNull();
    expect(await send()).toMatchObject({
      code: "23505",
      constraint: "outbound_messages_idempotency_unique",
    });
  });

  it("notifications: token de acción con expiración y único", async () => {
    const notif = (hash: string | null, expires: string | null) =>
      pgError(
        `insert into public.notifications
           (tenant_id, kind, priority, title, body, action_token_hash, action_expires_at)
         values ($1, 'turno_oportunidad', 'high', 'Oportunidad', 'Reynosa 3', $2, $3)`,
        [TENANT, hash, expires],
      );
    expect(await notif(TOKEN_HASH, "2026-11-09T16:00:00Z")).toBeNull();
    expect(await notif(TOKEN_HASH, "2026-11-09T16:00:00Z")).toMatchObject({ code: "23505" });
    expect(await notif("f".repeat(64), null)).toMatchObject({
      constraint: "notifications_action_consistent",
    });
    expect(await notif(null, null)).toBeNull();
  });

  it("wa_lid_map valida LID, teléfono y fuente", async () => {
    const lid = (l: string, phone: string | null, source: string) =>
      pgError(
        `insert into public.wa_lid_map (channel_id, lid, tenant_id, phone, source) values ($1, $2, $3, $4, $5)`,
        [channelId, l, TENANT, phone, source],
      );
    expect(await lid("100000000000003", "5218990000002", "payload_alt")).toBeNull();
    expect(await lid("100000000000004@lid", null, "manual")).toMatchObject({
      constraint: "wa_lid_map_lid_format",
    });
    expect(await lid("100000000000005", "+52 899", "manual")).toMatchObject({
      constraint: "wa_lid_map_phone_format",
    });
    expect(await lid("100000000000006", null, "adivinado")).toMatchObject({
      constraint: "wa_lid_map_source_check",
    });
  });

  it("borrar el agente borra sus datos; borrar el canal con agentes no se permite", async () => {
    expect(await claim()).toBeNull();
    expect(await pgError("delete from public.channels where id = $1", [channelId])).toMatchObject({
      code: "23503",
    });
    await q("delete from public.agent_configs where id = $1", [agentConfigId]);
    const { rows } = await q(
      "select count(*)::int as n from public.mod_turnos_claims where agent_config_id = $1",
      [agentConfigId],
    );
    expect(rows[0].n).toBe(0);
  });
});
