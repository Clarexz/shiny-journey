-- Tablas del módulo Apartador de turnos (fase 1, T1.9; plan, sección 3.2).
-- Prefijo mod_turnos_. El catálogo de sucursales se carga en 202611240200_mod_turnos_branches_data.sql.

-- ---------------------------------------------------------------------------
-- mod_turnos_branches (catálogo global, sin tenant_id: dato público de sucursales)
-- ---------------------------------------------------------------------------

create table public.mod_turnos_branches (
  code text primary key,
  city text not null,
  series text not null,
  number int not null,
  official_name text not null,
  colonia text not null,
  cp text null,
  address text not null,
  -- Normalizadas (minúsculas, sin acentos): {cumbres, mil cumbres}.
  keywords text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mod_turnos_branches_code_format check (code ~ '^[A-Z]{1,3}-[0-9]{4}$'),
  constraint mod_turnos_branches_city_format check (city ~ '^[a-z]+(_[a-z]+)*$'),
  constraint mod_turnos_branches_series_check check (series in ('S', 'F')),
  constraint mod_turnos_branches_number_positive check (number > 0),
  constraint mod_turnos_branches_cp_format check (cp is null or cp ~ '^[0-9]{5}$'),
  constraint mod_turnos_branches_keywords_no_nulls check (array_position(keywords, null) is null),
  -- Las palabras clave van normalizadas: sin mayúsculas ni acentos.
  constraint mod_turnos_branches_keywords_normalized
    check (array_to_string(keywords, ' ') ~ '^[a-z0-9 ]*$')
);

create index mod_turnos_branches_city_number_idx on public.mod_turnos_branches (city, number);

create trigger mod_turnos_branches_set_updated_at
  before update on public.mod_turnos_branches
  for each row execute function public.set_updated_at();

alter table public.mod_turnos_branches enable row level security;

-- ---------------------------------------------------------------------------
-- mod_turnos_availability (excepciones por fecha; la regla semanal vive en el config)
-- ---------------------------------------------------------------------------

create table public.mod_turnos_availability (
  tenant_id uuid not null,
  agent_config_id uuid not null,
  date date not null,
  available boolean not null,
  note text null,
  updated_by uuid null references public.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (agent_config_id, date),
  constraint mod_turnos_availability_agent_config_fk
    foreign key (agent_config_id, tenant_id) references public.agent_configs (id, tenant_id)
    on delete cascade
);

create index mod_turnos_availability_tenant_id_idx on public.mod_turnos_availability (tenant_id);

create trigger mod_turnos_availability_set_updated_at
  before update on public.mod_turnos_availability
  for each row execute function public.set_updated_at();

alter table public.mod_turnos_availability enable row level security;

-- ---------------------------------------------------------------------------
-- mod_turnos_claims (turnos apartados o tomados)
-- ---------------------------------------------------------------------------

create table public.mod_turnos_claims (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  agent_config_id uuid not null,
  agent_event_id uuid null,
  -- NULL si se apartó como ambigua (o una entrada aceptada sin código, como Reynosa 11 Olmo).
  branch_code text null references public.mod_turnos_branches (code) on delete restrict,
  branch_number int not null,
  date date not null,
  shift text not null,
  publisher_jid text not null,
  status text not null default 'dm_sent',
  origin text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mod_turnos_claims_agent_config_fk
    foreign key (agent_config_id, tenant_id) references public.agent_configs (id, tenant_id)
    on delete cascade,
  constraint mod_turnos_claims_agent_event_fk
    foreign key (agent_event_id, tenant_id) references public.agent_events (id, tenant_id)
    on delete set null (agent_event_id),
  constraint mod_turnos_claims_branch_number_positive check (branch_number > 0),
  constraint mod_turnos_claims_shift_check check (shift in ('matutino', 'vespertino')),
  constraint mod_turnos_claims_status_check
    check (status in ('dm_sent', 'confirmed', 'lost', 'cancelled')),
  constraint mod_turnos_claims_origin_check check (origin in ('auto', 'manual_take')),
  constraint mod_turnos_claims_publisher_jid_not_blank check (length(btrim(publisher_jid)) > 0),
  -- Deduplicación por turno: no se le escribe dos veces al mismo publicador por el mismo turno.
  constraint mod_turnos_claims_publisher_shift_unique
    unique (agent_config_id, publisher_jid, date, shift)
);

-- Un turno por día garantizado en la base de datos: es el candado atómico de APARTAR (2.2).
create unique index mod_turnos_claims_one_active_per_day
  on public.mod_turnos_claims (agent_config_id, date)
  where status in ('dm_sent', 'confirmed');

create index mod_turnos_claims_tenant_date_idx on public.mod_turnos_claims (tenant_id, date desc);
create index mod_turnos_claims_agent_event_id_idx on public.mod_turnos_claims (agent_event_id);

create trigger mod_turnos_claims_set_updated_at
  before update on public.mod_turnos_claims
  for each row execute function public.set_updated_at();

alter table public.mod_turnos_claims enable row level security;
