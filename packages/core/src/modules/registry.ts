import type { ChannelAdapter, ChannelCapability } from "@ravyn/channels";
import type { AgentPipeline } from "../agents/types";
import type { DefaultConfigContext, ModuleDefinition, ModuleKey, TriggerSpec } from "./types";

/**
 * Registro de módulos (plan, 4.2). Es la fuente de verdad de qué módulos existen.
 *
 * `core` no importa los módulos (ellos dependen de `core`): la lista concreta se arma donde se
 * usa, con `new ModuleRegistry([apartadorTurnos, ...])` (worker y web).
 */

const KEY_RE = /^[a-z][a-z0-9_]{1,47}$/;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

// El registro guarda definiciones con distintos `C`; se tipan como `any` solo aquí dentro.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyModule = ModuleDefinition<any, any>;

export interface ConfigIssue {
  /** Ruta del campo (`branches.0.number`); vacía si el error es del objeto completo. */
  path: string;
  message: string;
}

export type ConfigValidation<C> = { ok: true; config: C } | { ok: false; errors: ConfigIssue[] };

export class ModuleRegistryError extends Error {
  override name = "ModuleRegistryError";
}

export class ModuleRegistry {
  private readonly modules = new Map<ModuleKey, AnyModule>();
  private readonly pipelines = new Map<ModuleKey, Promise<AgentPipeline<unknown, unknown>>>();

  constructor(definitions: AnyModule[] = []) {
    for (const def of definitions) this.register(def);
  }

  register(def: AnyModule): this {
    if (!KEY_RE.test(def.key)) {
      throw new ModuleRegistryError(`Clave de módulo inválida: ${def.key} (snake_case)`);
    }
    if (this.modules.has(def.key)) {
      throw new ModuleRegistryError(`Módulo ya registrado: ${def.key}`);
    }
    if (!SEMVER_RE.test(def.version)) {
      throw new ModuleRegistryError(`${def.key}: version debe ser semver (x.y.z)`);
    }
    if (def.kind === "agent" && !def.server) {
      throw new ModuleRegistryError(`${def.key}: un módulo de tipo agent necesita server()`);
    }
    // El config por defecto tiene que pasar su propio esquema.
    const check = def.configSchema.safeParse(
      def.defaultConfig({ tenantTimezone: "America/Matamoros" }),
    );
    if (!check.success) {
      throw new ModuleRegistryError(`${def.key}: defaultConfig() no pasa configSchema`);
    }
    this.modules.set(def.key, def);
    return this;
  }

  has(key: ModuleKey): boolean {
    return this.modules.has(key);
  }

  get(key: ModuleKey): AnyModule | undefined {
    return this.modules.get(key);
  }

  require(key: ModuleKey): AnyModule {
    const def = this.modules.get(key);
    if (!def) throw new ModuleRegistryError(`Módulo desconocido: ${key}`);
    return def;
  }

  list(): AnyModule[] {
    return [...this.modules.values()];
  }

  agents(): AnyModule[] {
    return this.list().filter((m) => m.kind === "agent");
  }

  /** Valida un config con el esquema del módulo; los errores van por campo (respuesta 400, 4.3). */
  validateConfig(key: ModuleKey, raw: unknown): ConfigValidation<unknown> {
    const parsed = this.require(key).configSchema.safeParse(raw);
    if (parsed.success) return { ok: true, config: parsed.data };
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => ({
        path: i.path.map(String).join("."),
        message: i.message,
      })),
    };
  }

  defaultConfig(key: ModuleKey, ctx: DefaultConfigContext): unknown {
    return this.require(key).defaultConfig(ctx);
  }

  /** Disparadores de un config. Valida antes, para no rutear con un config corrupto. */
  triggers(key: ModuleKey, rawConfig: unknown): TriggerSpec[] {
    const v = this.validateConfig(key, rawConfig);
    if (!v.ok) {
      throw new ModuleRegistryError(`${key}: config inválido (${v.errors.length} errores)`);
    }
    return this.require(key).triggers(v.config);
  }

  /** Capacidades del canal que le faltan al módulo (vacío si puede activarse). */
  missingCapabilities(
    key: ModuleKey,
    adapter: Pick<ChannelAdapter, "capabilities">,
  ): ChannelCapability[] {
    return this.require(key).requiredCapabilities.filter((c) => !adapter.capabilities.has(c));
  }

  /** Carga (una sola vez) el pipeline de servidor del módulo. */
  loadPipeline<C = unknown, Db = unknown>(key: ModuleKey): Promise<AgentPipeline<C, Db>> {
    const def = this.require(key);
    if (!def.server) {
      return Promise.reject(new ModuleRegistryError(`${key}: no tiene pipeline de servidor`));
    }
    let p = this.pipelines.get(key);
    if (!p) {
      p = def.server();
      this.pipelines.set(key, p);
      p.catch(() => this.pipelines.delete(key));
    }
    return p as Promise<AgentPipeline<C, Db>>;
  }
}

/** JIDs de grupo de una lista de disparadores (para la tabla de ruteo del worker, 6.1). */
export function groupJidsFromTriggers(triggers: TriggerSpec[]): string[] {
  const out = new Set<string>();
  for (const t of triggers) {
    if (t.type === "message.group") for (const jid of t.chatJids) out.add(jid);
  }
  return [...out];
}
