-- Migración base de la plataforma (fase 0, T0.3).
-- Tablas: tenants, users, channels, channel_status_events, agent_configs,
-- agent_config_history, audit_log.
--
-- Reglas de la plataforma (ver docs/PLAN_IMPLEMENTACION.md, secciones 3 y 11.1):
-- - Toda tabla del esquema public tiene RLS activado y ninguna política (deny-all para
--   anon y authenticated). El servidor usa la service role, que ignora RLS.
-- - El aislamiento por tenant se aplica en código (tenantTable()). Las FK compuestas
--   (id, tenant_id) impiden además mezclar filas de tenants distintos.

-- ---------------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- tenants
-- ---------------------------------------------------------------------------

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  status text not null default 'active',
  modules_enabled text[] not null default '{}',
  config jsonb not null default '{}',
  timezone text not null default 'America/Matamoros',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenants_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint tenants_name_not_blank check (length(btrim(name)) > 0),
  constraint tenants_status_check check (status in ('active', 'paused', 'offboarding')),
  constraint tenants_modules_no_nulls check (array_position(modules_enabled, null) is null),
  constraint tenants_config_is_object check (jsonb_typeof(config) = 'object'),
  constraint tenants_timezone_not_blank check (length(btrim(timezone)) > 0)
);

create trigger tenants_set_updated_at
  before update on public.tenants
  for each row execute function public.set_updated_at();

alter table public.tenants enable row level security;

-- ---------------------------------------------------------------------------
-- users (perfil; id = auth.users.id)
-- ---------------------------------------------------------------------------

create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  tenant_id uuid null references public.tenants (id) on delete cascade,
  full_name text not null,
  role text not null,
  email text not null,
  created_at timestamptz not null default now(),
  constraint users_role_check
    check (role in ('ravyn_admin', 'ravyn_ops', 'tenant_owner', 'tenant_member')),
  -- El personal de Ravyn no pertenece a ningún tenant; los usuarios de cliente siempre sí.
  constraint users_role_tenant_check check ((role like 'ravyn\_%') = (tenant_id is null)),
  constraint users_full_name_not_blank check (length(btrim(full_name)) > 0),
  constraint users_email_format check (email ~ '^[^@\s]+@[^@\s]+$')
);

create index users_tenant_id_idx on public.users (tenant_id);

alter table public.users enable row level security;

-- ---------------------------------------------------------------------------
-- channels (un número conectado)
-- ---------------------------------------------------------------------------

create table public.channels (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  provider text not null,
  external_instance text not null unique,
  phone text null,
  status text not null default 'pending_qr',
  status_changed_at timestamptz not null default now(),
  last_inbound_at timestamptz null,
  webhook_token_hash text not null,
  settings jsonb not null default '{}',
  created_at timestamptz not null default now(),
  constraint channels_provider_check check (provider in ('evolution', 'meta_cloud')),
  constraint channels_status_check
    check (status in ('pending_qr', 'connecting', 'open', 'closed', 'logged_out', 'error')),
  constraint channels_phone_format check (phone is null or phone ~ '^[0-9]{8,15}$'),
  constraint channels_webhook_token_hash_format check (webhook_token_hash ~ '^[0-9a-f]{64}$'),
  constraint channels_settings_is_object check (jsonb_typeof(settings) = 'object'),
  -- Objetivo de las FK compuestas (id, tenant_id) de las tablas hijas.
  constraint channels_id_tenant_unique unique (id, tenant_id)
);

create index channels_tenant_id_idx on public.channels (tenant_id);
create index channels_status_idx on public.channels (status);

alter table public.channels enable row level security;

-- ---------------------------------------------------------------------------
-- channel_status_events (bitácora de conexión)
-- ---------------------------------------------------------------------------

create table public.channel_status_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  channel_id uuid not null,
  status text not null,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now(),
  constraint channel_status_events_channel_fk
    foreign key (channel_id, tenant_id) references public.channels (id, tenant_id)
    on delete cascade,
  constraint channel_status_events_status_check
    check (status in ('pending_qr', 'connecting', 'open', 'closed', 'logged_out', 'error')),
  constraint channel_status_events_detail_is_object check (jsonb_typeof(detail) = 'object')
);

create index channel_status_events_channel_created_idx
  on public.channel_status_events (channel_id, created_at desc);

alter table public.channel_status_events enable row level security;

-- ---------------------------------------------------------------------------
-- agent_configs (una instancia de módulo de agente para un tenant)
-- ---------------------------------------------------------------------------

create table public.agent_configs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  module_key text not null,
  channel_id uuid not null,
  name text not null,
  status text not null default 'observe',
  config jsonb not null,
  config_version int not null default 1,
  schema_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agent_configs_channel_fk
    -- NO ACTION (se valida al final de la sentencia): impide borrar un canal con agentes,
    -- pero permite el borrado en cascada de un tenant completo.
    foreign key (channel_id, tenant_id) references public.channels (id, tenant_id)
    on delete no action,
  constraint agent_configs_module_key_format check (module_key ~ '^[a-z][a-z0-9_]*$'),
  constraint agent_configs_name_not_blank check (length(btrim(name)) > 0),
  constraint agent_configs_status_check check (status in ('active', 'observe', 'paused')),
  constraint agent_configs_config_is_object check (jsonb_typeof(config) = 'object'),
  constraint agent_configs_config_version_positive check (config_version >= 1),
  constraint agent_configs_schema_version_not_blank check (length(btrim(schema_version)) > 0),
  constraint agent_configs_tenant_module_channel_unique unique (tenant_id, module_key, channel_id),
  constraint agent_configs_id_tenant_unique unique (id, tenant_id)
);

create index agent_configs_tenant_id_idx on public.agent_configs (tenant_id);
create index agent_configs_channel_id_idx on public.agent_configs (channel_id);

create trigger agent_configs_set_updated_at
  before update on public.agent_configs
  for each row execute function public.set_updated_at();

alter table public.agent_configs enable row level security;

-- ---------------------------------------------------------------------------
-- agent_config_history (auditoría de cambios de configuración)
-- ---------------------------------------------------------------------------

create table public.agent_config_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  agent_config_id uuid not null,
  config jsonb not null,
  config_version int not null,
  changed_by uuid null references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint agent_config_history_agent_config_fk
    foreign key (agent_config_id, tenant_id) references public.agent_configs (id, tenant_id)
    on delete cascade,
  constraint agent_config_history_config_is_object check (jsonb_typeof(config) = 'object'),
  constraint agent_config_history_version_unique unique (agent_config_id, config_version)
);

create index agent_config_history_tenant_id_idx on public.agent_config_history (tenant_id);

alter table public.agent_config_history enable row level security;

-- ---------------------------------------------------------------------------
-- audit_log (acciones de personas en el panel)
-- ---------------------------------------------------------------------------

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid null references public.users (id) on delete set null,
  tenant_id uuid null references public.tenants (id) on delete set null,
  action text not null,
  target text null,
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  constraint audit_log_action_not_blank check (length(btrim(action)) > 0),
  constraint audit_log_data_is_object check (jsonb_typeof(data) = 'object')
);

create index audit_log_tenant_created_idx on public.audit_log (tenant_id, created_at desc);
create index audit_log_actor_created_idx on public.audit_log (actor_user_id, created_at desc);

alter table public.audit_log enable row level security;
