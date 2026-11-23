import type { Database } from "./types.gen";

type PublicTables = Database["public"]["Tables"];

export type TableName = keyof PublicTables;
export type Row<T extends TableName> = PublicTables[T]["Row"];
export type InsertRow<T extends TableName> = PublicTables[T]["Insert"];
export type UpdateRow<T extends TableName> = PublicTables[T]["Update"];

/** Tablas del esquema public que tienen la columna `tenant_id`. */
export type TenantTableName = {
  [K in TableName]: "tenant_id" extends keyof Row<K> ? K : never;
}[TableName];

/**
 * Lista en tiempo de ejecución de las tablas con `tenant_id`.
 * El tipo `satisfies` obliga a mantenerla completa: si una migración agrega una tabla con
 * `tenant_id` y se regeneran los tipos, typecheck falla hasta que se agregue aquí.
 * La usa la regla de ESLint que prohíbe `.from("<tabla>")` fuera de packages/db.
 */
export const TENANT_TABLES = [
  "agent_config_history",
  "agent_configs",
  "agent_events",
  "audit_log",
  "captured_messages",
  "channel_status_events",
  "channels",
  "inbound_dedupe",
  "mod_turnos_availability",
  "mod_turnos_claims",
  "notifications",
  "outbound_messages",
  "push_subscriptions",
  "users",
  "wa_lid_map",
] as const satisfies readonly TenantTableName[];

type MissingTenantTables = Exclude<TenantTableName, (typeof TENANT_TABLES)[number]>;
// Si esta línea falla, falta una tabla en TENANT_TABLES.
export const _tenantTablesAreComplete: [MissingTenantTables] extends [never] ? true : never = true;
