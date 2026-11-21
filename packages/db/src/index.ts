export { createAdminClient, type AdminClient, type AdminClientOptions } from "./admin";
export {
  TENANT_TABLES,
  type InsertRow,
  type Row,
  type TableName,
  type TenantTableName,
  type UpdateRow,
} from "./tables";
export {
  tenantTable,
  TenantScopeError,
  type TenantInsert,
  type TenantScope,
  type QueryResult,
} from "./tenant-table";
export { getTenant, getUserProfile, type TenantRecord, type UserProfile } from "./users";
export { findTablesWithoutRls, type SqlClient, type TableWithoutRls } from "./check-rls";
export type { Database, Json } from "./types.gen";
