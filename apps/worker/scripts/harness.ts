/**
 * Harness de webhooks (plan, 13.3; T1.16).
 *
 *   npm run harness -- --scenario privacy
 *   npm run harness -- --scenario real-messages
 *   npm run harness -- --scenario lid
 *   npm run harness -- --scenario burst --n 20
 *   npm run harness -- --scenario disconnect
 *
 * Arma el worker en el mismo proceso (compose.ts, igual que main.ts) con CHANNEL_DRY_RUN, Redis
 * y BullMQ reales y la base local: siembra un tenant de prueba con su canal y su agente, manda
 * payloads de Evolution construidos con los fixtures reales anonimizados (T1.6), compara contra
 * lo esperado y borra todo al terminar. Sale con código 1 si algo no coincide (se usa en CI).
 *
 * Necesita DATABASE_URL y REDIS_URL. Si además están SUPABASE_INTERNAL_URL y
 * SUPABASE_SERVICE_ROLE_KEY, la tabla de ruteo se carga como en producción (PostgREST); si no,
 * con una consulta equivalente por Postgres.
 *
 * El pipeline (T1.15) todavía no procesa la cola: los escenarios verifican la recepción, el
 * ruteo, la deduplicación y la privacidad. T1.15 agrega las decisiones y los envíos.
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { ModuleRegistry } from "@ravyn/core";
import { createAdminClient, loadRoutingSnapshot, type RoutingSnapshot } from "@ravyn/db";
import { apartadorTurnos } from "@ravyn/module-apartador-turnos/definition";
import { DOCTOR_ACCEPTED } from "@ravyn/module-apartador-turnos/fixtures/doctor-accepted";
import { REAL_MESSAGES } from "@ravyn/module-apartador-turnos/fixtures/real-messages";
import pg from "pg";
import { composeWorker } from "../src/compose";
import { createLogger } from "../src/logger";
import { closeQueues, createQueues } from "../src/queues";
import { createRedis } from "../src/redis";
import type { InboundJobData } from "../src/webhooks/inbound-job";
import { dedupeKey } from "../src/webhooks/inbound-sink";
import type { ChannelEventHandler } from "../src/webhooks/route";
import { hashToken } from "../src/webhooks/token";

const SCENARIOS = ["privacy", "real-messages", "lid", "burst", "disconnect", "latency"] as const;
type Scenario = (typeof SCENARIOS)[number];

const { values } = parseArgs({
  options: { scenario: { type: "string" }, n: { type: "string", default: "20" } },
});
const scenario = values.scenario as Scenario;
if (!SCENARIOS.includes(scenario)) {
  console.error(`Escenario desconocido. Usa --scenario con uno de: ${SCENARIOS.join(", ")}`);
  process.exit(2);
}
if (scenario === "latency") {
  console.error("latency necesita el pipeline del Apartador (T1.15); todavía no está disponible.");
  process.exit(2);
}

const DATABASE_URL = process.env.DATABASE_URL;
const REDIS_URL = process.env.REDIS_URL;
if (!DATABASE_URL || !REDIS_URL) {
  console.error("Faltan DATABASE_URL y REDIS_URL.");
  process.exit(2);
}

// Fixtures

const FIXTURES = fileURLToPath(
  new URL("../../../modules/apartador-turnos/fixtures/evolution/", import.meta.url),
);
type Payload = {
  instance: string;
  data: Record<string, unknown> & { key: Record<string, unknown> };
};
const fixture = (name: string): Payload => JSON.parse(readFileSync(FIXTURES + name, "utf8"));

const STAMP = `${Date.now()}-${randomBytes(3).toString("hex")}`;
const INSTANCE = `harness-${STAMP}`;
const TARGET_GROUP = "120363000000000001@g.us";
const OTHER_GROUP = "120363999999999999@g.us";
const B_PHONE = "5218990000002";
const B_LID = "100000000000003";

function withInstance(p: Payload): Payload {
  return { ...p, instance: INSTANCE };
}

function groupText(
  text: string,
  id: string,
  opts: { group?: string; alt?: boolean; ts?: number } = {},
) {
  const p = withInstance(fixture("group-text-quoted-lid-alt.json"));
  p.data.key = { ...p.data.key, id, remoteJid: opts.group ?? TARGET_GROUP };
  if (opts.alt === false) delete p.data.key.participantAlt;
  p.data.message = { conversation: text };
  if (opts.ts) p.data.messageTimestamp = opts.ts;
  return p;
}

function directText(text: string, id: string) {
  const p = withInstance(fixture("dm-text-inbound.json"));
  p.data.key = { ...p.data.key, id };
  p.data.message = { conversation: text };
  return p;
}

function ownGroupText(text: string, id: string) {
  const p = withInstance(fixture("group-text-fromme-lid-sin-alt.json"));
  p.data.key = { ...p.data.key, id, remoteJid: TARGET_GROUP };
  p.data.message = { conversation: text };
  return p;
}

function connection(state: string, statusReason: number) {
  const p = withInstance(fixture("connection-update-open.json"));
  p.data = { ...p.data, instance: INSTANCE, state, statusReason } as Payload["data"];
  return p;
}

// Resultados

interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}
const checks: Check[] = [];
const check = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });
const eq = (name: string, actual: unknown, expected: unknown) =>
  check(
    name,
    JSON.stringify(actual) === JSON.stringify(expected),
    `esperado ${JSON.stringify(expected)}, obtenido ${JSON.stringify(actual)}`,
  );

// Base de datos

const db = new pg.Client({ connectionString: DATABASE_URL });
await db.connect();

async function rowCounts(): Promise<Record<string, number>> {
  const { rows } = await db.query<{ t: string }>(
    "select tablename as t from pg_tables where schemaname = 'public' order by 1",
  );
  const out: Record<string, number> = {};
  for (const { t } of rows) {
    const r = await db.query<{ n: number }>(`select count(*)::int as n from public."${t}"`);
    out[t] = r.rows[0]!.n;
  }
  return out;
}

const token = randomBytes(24).toString("hex");
const tenant = await db.query<{ id: string }>(
  "insert into public.tenants (slug, name) values ($1, 'Harness') returning id",
  [`harness-${STAMP.toLowerCase()}`],
);
const tenantId = tenant.rows[0]!.id;

let exitCode = 1;
const redis = createRedis(REDIS_URL, "harness");
const queues = createQueues(redis, `harness-${STAMP}`);

try {
  const channel = await db.query<{ id: string }>(
    `insert into public.channels (tenant_id, provider, external_instance, phone, status, webhook_token_hash)
     values ($1, 'evolution', $2, '5218990000001', 'open', $3) returning id`,
    [tenantId, INSTANCE, hashToken(token)],
  );
  const channelId = channel.rows[0]!.id;
  const config = apartadorTurnos.configSchema.parse({
    groupJid: TARGET_GROUP,
    branches: { accepted: DOCTOR_ACCEPTED },
  });
  const agent = await db.query<{ id: string }>(
    `insert into public.agent_configs (tenant_id, module_key, channel_id, name, status, config, schema_version)
     values ($1, $2, $3, 'Apartador (harness)', 'observe', $4, $5) returning id`,
    [tenantId, apartadorTurnos.key, channelId, JSON.stringify(config), apartadorTurnos.version],
  );
  const agentId = agent.rows[0]!.id;

  // Carga de la tabla de ruteo: como en producción si hay credenciales de Supabase.
  const supabaseUrl = process.env.SUPABASE_INTERNAL_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const loadRouting = async (): Promise<RoutingSnapshot> => {
    if (supabaseUrl && serviceKey) {
      return loadRoutingSnapshot(
        createAdminClient({ url: supabaseUrl, serviceRoleKey: serviceKey }),
      );
    }
    const channels = await db.query(
      "select id, tenant_id, provider, external_instance, phone, status, settings, webhook_token_hash from public.channels",
    );
    const agents = await db.query(
      "select id, tenant_id, module_key, channel_id, status, config, config_version from public.agent_configs where status in ('active', 'observe')",
    );
    return { channels: channels.rows, agents: agents.rows };
  };

  // Logs capturados en el nivel más detallado: la privacidad se verifica sobre todo lo escrito.
  const logLines: string[] = [];
  const logger = createLogger({
    level: "trace",
    destination: new Writable({
      write(chunk, _e, cb) {
        logLines.push(String(chunk));
        cb();
      },
    }),
  });

  const channelEvents: Array<{ kind: string; status?: string }> = [];
  const onChannelEvent: ChannelEventHandler = (_route, event) => {
    channelEvents.push(
      event.kind === "connection" ? { kind: "connection", status: event.status } : { kind: "qr" },
    );
  };

  const { app, routing, counters, outbox } = await composeWorker({
    logger,
    redis,
    queues,
    loadRouting,
    modules: new ModuleRegistry([apartadorTurnos]),
    dryRun: true,
    evolution: { baseUrl: "http://evolution.invalid", apiKey: "harness" },
    health: async () => ({ ok: true, redis: true, db: true }),
    onChannelEvent,
  });
  await app.ready();

  const url = `/webhooks/evolution/${channelId}/${token}`;
  const post = async (payload: unknown) => {
    const res = await app.inject({ method: "POST", url, payload: payload as object });
    if (res.statusCode !== 200) check(`respuesta 200`, false, `HTTP ${res.statusCode}`);
    return res;
  };
  const jobs = async (): Promise<InboundJobData[]> =>
    (await queues.inbound.getJobs(["prioritized", "waiting", "active", "delayed"])).map(
      (j) => j.data as InboundJobData,
    );

  eq(
    "la tabla de ruteo suscribe el grupo objetivo",
    routing.get(channelId)?.groupJids.get(TARGET_GROUP),
    [agentId],
  );
  const before = await rowCounts();

  switch (scenario) {
    case "privacy": {
      const secrets = {
        dm: `Doctor, mi hijo tiene fiebre ${STAMP}`,
        other: `Mensaje del otro grupo con nombre de paciente ${STAMP}`,
        own: `Mensaje propio en el grupo ${STAMP}`,
      };
      await post(directText(secrets.dm, `P-DM-${STAMP}`));
      await post(groupText(secrets.other, `P-OG-${STAMP}`, { group: OTHER_GROUP }));
      await post(ownGroupText(secrets.own, `P-ME-${STAMP}`));

      eq("DM, otro grupo y mensajes propios: 0 trabajos", (await jobs()).length, 0);
      const keys = await Promise.all(
        ["P-DM", "P-OG", "P-ME"].map((p) => redis.exists(dedupeKey(channelId, `${p}-${STAMP}`))),
      );
      eq("DM, otro grupo y mensajes propios: 0 claves de deduplicación", keys, [0, 0, 0]);
      eq("contador de ignorados", counters.snapshot().ignoredByChannel[channelId], 3);

      // Control positivo: el grupo objetivo sí entra (si no, la prueba pasaría en vacío).
      const target = `Busco cobertura hoy matutino Reynosa 3 cumbres ${STAMP}`;
      await post(groupText(target, `P-T-${STAMP}`));
      eq("grupo objetivo: exactamente 1 trabajo", (await jobs()).length, 1);

      const after = await rowCounts();
      const changed = Object.keys(after).filter((t) => after[t] !== before[t]);
      eq("0 filas nuevas en todas las tablas", changed, []);
      const logs = logLines.join("");
      const leaked = [...Object.values(secrets), target, token, B_PHONE, B_LID, "Persona B"].filter(
        (s) => logs.includes(s),
      );
      eq("0 líneas de log con contenido, teléfonos, nombres o el token", leaked, []);
      eq("0 envíos", outbox.sent.length, 0);
      break;
    }

    case "lid": {
      await post(
        groupText(`Busco cobertura hoy matutino reynosa 3 cumbres ${STAMP}`, `L-ALT-${STAMP}`),
      );
      await post(
        groupText(`Busco cobertura hoy matutino reynosa 3 cumbres ${STAMP}`, `L-SIN-${STAMP}`, {
          alt: false,
        }),
      );
      const byId = Object.fromEntries(
        (await jobs()).map((j) => [j.message.externalId, j.message.sender]),
      );
      eq("@lid con participantAlt: teléfono y LID", byId[`L-ALT-${STAMP}`], {
        jid: `${B_LID}@lid`,
        phone: B_PHONE,
        lid: B_LID,
        name: "Persona B",
      });
      eq("@lid sin campo alterno: LID sin teléfono", byId[`L-SIN-${STAMP}`], {
        jid: `${B_LID}@lid`,
        phone: null,
        lid: B_LID,
        name: "Persona B",
      });
      break;
    }

    case "real-messages": {
      for (const m of REAL_MESSAGES) {
        await post(
          groupText(m.text, `R-${m.id}-${STAMP}`, {
            ts: Math.floor(new Date(m.at).getTime() / 1000),
          }),
        );
      }
      const all = await jobs();
      eq("los 5 mensajes reales se encolan", all.length, REAL_MESSAGES.length);
      const texts = new Map(all.map((j) => [j.message.externalId, j]));
      for (const m of REAL_MESSAGES) {
        const job = texts.get(`R-${m.id}-${STAMP}`);
        eq(
          `${m.id}: texto, agente y hora del mensaje`,
          [job?.message.text, job?.agentConfigIds, job?.message.waTimestamp],
          [m.text, [agentId], new Date(m.at).toISOString()],
        );
      }
      // T1.15: aquí se agregan las decisiones de la tabla de 7.7 y los envíos del Fake.
      break;
    }

    case "burst": {
      const n = Number(values.n);
      for (let i = 0; i < n; i++) {
        const p = groupText(
          `Busco cobertura hoy matutino reynosa 3 cumbres #${i} ${STAMP}`,
          `B-${i}-${STAMP}`,
        );
        await post(p);
        await post(p); // reintento de Evolution
      }
      eq(`ráfaga de ${n} con duplicados: ${n} trabajos`, (await jobs()).length, n);
      eq("duplicados descartados", counters.snapshot().duplicates, n);
      // T1.15: aquí se agregan los límites de envío (6 por hora) sobre el Fake.
      break;
    }

    case "disconnect": {
      await post(connection("close", 428));
      await post(connection("close", 401));
      await post(connection("open", 200));
      eq("close, logged_out y open llegan al manejador", channelEvents, [
        { kind: "connection", status: "closed" },
        { kind: "connection", status: "logged_out" },
        { kind: "connection", status: "open" },
      ]);
      eq("0 trabajos", (await jobs()).length, 0);
      // T1.18: aquí se agregan channel_status_events y los avisos.
      break;
    }
  }

  await app.close();
  exitCode = checks.every((c) => c.ok) ? 0 : 1;
} catch (err) {
  check(
    "el escenario terminó sin errores",
    false,
    err instanceof Error ? err.message : String(err),
  );
} finally {
  // Limpieza: cola, claves de Redis y datos del tenant de prueba (en cascada).
  await Promise.all(
    Object.values(queues).map((q) => q.obliterate({ force: true }).catch(() => {})),
  );
  await closeQueues(queues).catch(() => {});
  const keys = await redis.keys(`dedupe:*`).catch(() => [] as string[]);
  const ours = [];
  for (const k of keys) {
    const ch = await db.query(
      "select 1 from public.channels where id::text = $1 and tenant_id = $2",
      [k.split(":")[1], tenantId],
    );
    if (ch.rowCount) ours.push(k);
  }
  if (ours.length) await redis.del(...ours);
  await redis.quit();
  await db.query("delete from public.tenants where id = $1", [tenantId]);
  await db.end();
}

for (const c of checks) {
  console.warn(`${c.ok ? "OK   " : "FALLA"} ${c.name}${c.ok ? "" : `: ${c.detail ?? ""}`}`);
}
console.warn(
  `\nharness ${scenario}: ${checks.filter((c) => c.ok).length}/${checks.length} verificaciones`,
);
process.exit(checks.every((c) => c.ok) ? exitCode : 1);
