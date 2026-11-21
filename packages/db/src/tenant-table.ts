import type { AdminClient } from "./admin";
import type { InsertRow, Row, TenantTableName, UpdateRow } from "./tables";

/** Lo mínimo que tenantTable() necesita de un contexto de tenant. */
export interface TenantScope {
  db: AdminClient;
  tenantId: string;
}

export class TenantScopeError extends Error {
  override name = "TenantScopeError";
}

function assertTenantId(tenantId: unknown): asserts tenantId is string {
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    throw new TenantScopeError("tenantTable: el contexto no tiene tenantId");
  }
}

function withTenant<T extends Record<string, unknown>>(row: T, tenantId: string): T {
  const given = row["tenant_id"];
  if (given !== undefined && given !== tenantId) {
    throw new TenantScopeError("tenantTable: la fila trae un tenant_id distinto al del contexto");
  }
  return { ...row, tenant_id: tenantId };
}

function withoutTenantChange<T extends Record<string, unknown>>(values: T, tenantId: string): T {
  const given = values["tenant_id"];
  if (given !== undefined && given !== tenantId) {
    throw new TenantScopeError("tenantTable: no se puede mover una fila a otro tenant");
  }
  const { tenant_id: _ignored, ...rest } = values;
  return rest as T;
}

/**
 * Acceso tenant-scoped a una tabla con `tenant_id` (plan, sección 2.4).
 *
 * - `select`, `update` y `delete` agregan `.eq("tenant_id", ctx.tenantId)`.
 * - `insert` y `upsert` inyectan `tenant_id` (y rechazan uno distinto).
 * - `update` no permite cambiar `tenant_id`.
 *
 * El resultado es el builder normal de supabase-js, así que se pueden encadenar más filtros.
 * Es aislamiento en aplicación (principio 7): RLS deny-all es la segunda capa.
 */
export function tenantTable<T extends TenantTableName>(ctx: TenantScope, table: T) {
  assertTenantId(ctx.tenantId);
  const tenantId = ctx.tenantId;
  // supabase-js no puede resolver columnas sobre un nombre de tabla genérico; el tipo
  // público de cada método se fija abajo con Row/InsertRow/UpdateRow de la tabla.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const from = () => ctx.db.from(table) as any;

  return {
    table,
    tenantId,
    select(columns = "*", options?: { count?: "exact" | "planned" | "estimated"; head?: boolean }) {
      return from().select(columns, options).eq("tenant_id", tenantId) as TenantQuery<Row<T>[]>;
    },
    insert(values: TenantInsert<T> | TenantInsert<T>[]) {
      const rows = Array.isArray(values)
        ? values.map((v) => withTenant(v as Record<string, unknown>, tenantId))
        : withTenant(values as Record<string, unknown>, tenantId);
      return from().insert(rows) as TenantMutation<Row<T>>;
    },
    upsert(
      values: TenantInsert<T> | TenantInsert<T>[],
      options?: { onConflict?: string; ignoreDuplicates?: boolean },
    ) {
      const rows = Array.isArray(values)
        ? values.map((v) => withTenant(v as Record<string, unknown>, tenantId))
        : withTenant(values as Record<string, unknown>, tenantId);
      return from().upsert(rows, options) as TenantMutation<Row<T>>;
    },
    update(values: UpdateRow<T>) {
      const clean = withoutTenantChange(values as Record<string, unknown>, tenantId);
      return from().update(clean).eq("tenant_id", tenantId) as TenantMutation<Row<T>>;
    },
    delete() {
      return from().delete().eq("tenant_id", tenantId) as TenantMutation<Row<T>>;
    },
  };
}

/** Fila para insertar: `tenant_id` es opcional porque lo inyecta tenantTable(). */
export type TenantInsert<T extends TenantTableName> = Omit<InsertRow<T>, "tenant_id"> & {
  tenant_id?: string;
};

/** Subconjunto del builder de PostgREST que exponemos con tipos de la tabla. */
export interface TenantQuery<R> extends PromiseLike<QueryResult<R>> {
  eq(column: string, value: unknown): TenantQuery<R>;
  neq(column: string, value: unknown): TenantQuery<R>;
  in(column: string, values: readonly unknown[]): TenantQuery<R>;
  is(column: string, value: null | boolean): TenantQuery<R>;
  gte(column: string, value: unknown): TenantQuery<R>;
  lte(column: string, value: unknown): TenantQuery<R>;
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): TenantQuery<R>;
  limit(count: number): TenantQuery<R>;
  range(from: number, to: number): TenantQuery<R>;
  single(): PromiseLike<QueryResult<R extends (infer E)[] ? E : R>>;
  maybeSingle(): PromiseLike<QueryResult<(R extends (infer E)[] ? E : R) | null>>;
}

export interface TenantMutation<R> extends PromiseLike<QueryResult<null>> {
  eq(column: string, value: unknown): TenantMutation<R>;
  in(column: string, values: readonly unknown[]): TenantMutation<R>;
  select(columns?: string): TenantQuery<R[]>;
}

export interface QueryResult<R> {
  data: R | null;
  error: { message: string; code?: string; details?: string | null; hint?: string | null } | null;
  count?: number | null;
  status?: number;
}
