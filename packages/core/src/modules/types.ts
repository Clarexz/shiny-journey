/**
 * Definición de un módulo (plan, 4.1). Un módulo vive en `modules/<clave>/` y exporta una
 * `ModuleDefinition`; la base de datos solo guarda su clave y su configuración.
 *
 * Este archivo es seguro para el cliente: solo importa tipos. El código de servidor del módulo
 * se carga con `server()` (import dinámico) y el panel nunca lo llama.
 */
import type { ChannelCapability } from "@ravyn/channels";
import type { ZodType } from "zod";
import type { AgentPipeline } from "../agents/types";

/** Clave estable en snake_case (`apartador_turnos`). Es la que guardan `modules_enabled` y `agent_configs.module_key`. */
export type ModuleKey = string;

export type TriggerSpec =
  | { type: "message.group"; chatJids: string[] }
  /** Fase 2. */
  | { type: "message.direct"; fromPhones?: string[] }
  /** Fase 2. */
  | { type: "schedule"; cron: string };

export interface ActionSpec<I = unknown> {
  description: string;
  inputSchema: ZodType<I>;
}

export interface DefaultConfigContext {
  tenantTimezone: string;
}

export interface ModuleDefinition<C = unknown, Db = unknown> {
  key: ModuleKey;
  /** Semver del esquema de configuración (`agent_configs.schema_version`). */
  version: string;
  kind: "agent" | "feature";
  /** Nombre visible ("Apartador de turnos"); nunca menciona el modelo. */
  displayName: string;
  description: string;
  configSchema: ZodType<C>;
  defaultConfig: (ctx: DefaultConfigContext) => C;
  migrateConfig?: (old: unknown, fromVersion: string) => C;
  /** La activación falla si el canal no las tiene (p. ej. Meta Cloud no tiene `read_groups`). */
  requiredCapabilities: ChannelCapability[];
  /** Qué mensajes le interesan, derivados de su config. */
  triggers: (config: C) => TriggerSpec[];
  /** Pipeline del agente; solo del lado del servidor. */
  server?: () => Promise<AgentPipeline<C, Db>>;
  /** Acciones invocables desde el panel o una notificación ("tomar"). */
  actions?: Record<string, ActionSpec>;
}

/** Manifiesto de navegación del módulo (seguro para el cliente, 4.1 y 4.4). */
export interface ModuleUiManifest {
  key: ModuleKey;
  nav: Array<{ href: string; label: string; icon: string }>;
}

/** Ayuda a inferir `C` desde el esquema sin escribir el genérico a mano. */
export function defineModule<C, Db = unknown>(
  def: ModuleDefinition<C, Db>,
): ModuleDefinition<C, Db> {
  return def;
}
