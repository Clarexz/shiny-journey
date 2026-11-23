-- Tablas del motor de agentes y de avisos (fase 1, T1.9).
-- Tablas: inbound_dedupe, captured_messages, agent_events, outbound_messages, notifications,
-- push_subscriptions y wa_lid_map (plan, sección 3.1).
--
-- Mismas reglas que la migración base: RLS activado sin políticas en todas, FK compuestas
-- (id, tenant_id) para no mezclar tenants y sin privilegios para anon ni authenticated (los
-- default privileges de 202611230000 ya los quitan para las tablas nuevas).

-- Los usuarios de un tenant se referencian con (id, tenant_id), igual que los canales.
alter table public.users add constraint users_id_tenant_unique unique (id, tenant_id);

-- ---------------------------------------------------------------------------
-- inbound_dedupe (segunda barrera de deduplicación; la primera es Redis)
-- ---------------------------------------------------------------------------

create table public.inbound_dedupe (
  channel_id uuid not null,
  external_id text not null,
  tenant_id uuid not null,
  received_at timestamptz not null default now(),
  primary key (channel_id, external_id),
  constraint inbound_dedupe_channel_fk
    foreign key (channel_id, tenant_id) references public.channels (id, tenant_id)
    on delete cascade,
  constraint inbound_dedupe_external_id_not_blank check (length(btrim(external_id)) > 0)
);

-- Purga a los 7 días (11.4).
create index inbound_dedupe_received_at_idx on public.inbound_dedupe (received_at);

alter table public.inbound_dedupe enable row level security;

-- ---------------------------------------------------------------------------
-- captured_messages (solo mensajes del grupo objetivo que pasaron el prefiltro)
-- ---------------------------------------------------------------------------

create table public.captured_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  channel_id uuid not null,
  agent_config_id uuid not null,
  external_id text not null,
  chat_jid text not null,
  sender_jid text not null,
  sender_phone text null,
  sender_name text null,
  -- Se pone en NULL a los 30 días (11.4); text_purged_at registra cuándo.
  text text null,
  wa_timestamp timestamptz not null,
  received_at timestamptz not null,
  text_purged_at timestamptz null,
  created_at timestamptz not null default now(),
  constraint captured_messages_channel_fk
    foreign key (channel_id, tenant_id) references public.channels (id, tenant_id)
    on delete cascade,
  constraint captured_messages_agent_config_fk
    foreign key (agent_config_id, tenant_id) references public.agent_configs (id, tenant_id)
    on delete cascade,
  constraint captured_messages_channel_external_unique unique (channel_id, external_id),
  constraint captured_messages_id_tenant_unique unique (id, tenant_id),
  constraint captured_messages_chat_jid_group check (chat_jid ~ '@g\.us$'),
  constraint captured_messages_sender_jid_not_blank check (length(btrim(sender_jid)) > 0),
  constraint captured_messages_sender_phone_format
    check (sender_phone is null or sender_phone ~ '^[0-9]{8,15}$'),
  constraint captured_messages_purge_consistent
    check (text_purged_at is null or text is null)
);

create index captured_messages_tenant_received_idx
  on public.captured_messages (tenant_id, received_at desc);
create index captured_messages_agent_config_id_idx on public.captured_messages (agent_config_id);
-- Purga del texto (11.4): solo filas que todavía lo tienen.
create index captured_messages_text_purge_idx
  on public.captured_messages (received_at) where text is not null;

alter table public.captured_messages enable row level security;

-- ---------------------------------------------------------------------------
-- agent_events (cada decisión; alimenta el historial y las métricas)
-- ---------------------------------------------------------------------------

create table public.agent_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  agent_config_id uuid not null,
  captured_message_id uuid null,
  kind text not null,
  decision text null,
  reasons text[] not null default '{}',
  extraction jsonb null,
  latency jsonb null,
  llm jsonb null,
  feedback text null,
  feedback_at timestamptz null,
  created_at timestamptz not null default now(),
  constraint agent_events_agent_config_fk
    foreign key (agent_config_id, tenant_id) references public.agent_configs (id, tenant_id)
    on delete cascade,
  constraint agent_events_captured_message_fk
    foreign key (captured_message_id, tenant_id) references public.captured_messages (id, tenant_id)
    on delete set null (captured_message_id),
  constraint agent_events_id_tenant_unique unique (id, tenant_id),
  constraint agent_events_kind_check check (kind in ('decision', 'action_result', 'error')),
  constraint agent_events_decision_check
    check (decision is null or decision in ('APARTAR', 'NOTIFICAR', 'DESCARTAR', 'OBSERVAR')),
  constraint agent_events_decision_required check (kind <> 'decision' or decision is not null),
  constraint agent_events_reasons_no_nulls check (array_position(reasons, null) is null),
  constraint agent_events_extraction_is_object
    check (extraction is null or jsonb_typeof(extraction) = 'object'),
  constraint agent_events_latency_is_object
    check (latency is null or jsonb_typeof(latency) = 'object'),
  constraint agent_events_llm_is_object check (llm is null or jsonb_typeof(llm) = 'object'),
  constraint agent_events_feedback_check
    check (feedback is null or feedback in ('correcto', 'incorrecto')),
  constraint agent_events_feedback_at_consistent check ((feedback is null) = (feedback_at is null))
);

create index agent_events_tenant_created_idx on public.agent_events (tenant_id, created_at desc);
create index agent_events_agent_decision_created_idx
  on public.agent_events (agent_config_id, decision, created_at desc);
create index agent_events_captured_message_id_idx on public.agent_events (captured_message_id);

alter table public.agent_events enable row level security;

-- ---------------------------------------------------------------------------
-- outbound_messages (todo lo que el agente envía)
-- ---------------------------------------------------------------------------

create table public.outbound_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  channel_id uuid not null,
  agent_event_id uuid null,
  -- `{agentEventId}:{to}` (6.3): un fallo después de sendText nunca reenvía el DM.
  idempotency_key text not null,
  to_jid text not null,
  template_id text not null,
  body text not null,
  status text not null default 'queued',
  provider_message_id text null,
  error text null,
  origin text not null,
  sent_at timestamptz null,
  created_at timestamptz not null default now(),
  constraint outbound_messages_channel_fk
    foreign key (channel_id, tenant_id) references public.channels (id, tenant_id)
    on delete cascade,
  constraint outbound_messages_agent_event_fk
    foreign key (agent_event_id, tenant_id) references public.agent_events (id, tenant_id)
    on delete set null (agent_event_id),
  constraint outbound_messages_idempotency_unique unique (channel_id, idempotency_key),
  constraint outbound_messages_status_check
    check (status in ('queued', 'sent', 'failed', 'skipped_rate_limit')),
  constraint outbound_messages_origin_check check (origin in ('auto', 'manual_take')),
  constraint outbound_messages_to_jid_not_blank check (length(btrim(to_jid)) > 0),
  constraint outbound_messages_template_id_not_blank check (length(btrim(template_id)) > 0),
  constraint outbound_messages_body_not_blank check (length(btrim(body)) > 0),
  constraint outbound_messages_sent_consistent
    check ((status = 'sent') = (sent_at is not null and provider_message_id is not null))
);

create index outbound_messages_channel_sent_idx on public.outbound_messages (channel_id, sent_at desc);
create index outbound_messages_tenant_created_idx
  on public.outbound_messages (tenant_id, created_at desc);
create index outbound_messages_agent_event_id_idx on public.outbound_messages (agent_event_id);

alter table public.outbound_messages enable row level security;

-- ---------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  -- NULL: para todos los usuarios del tenant.
  user_id uuid null,
  kind text not null,
  priority text not null,
  title text not null,
  body text not null,
  payload jsonb not null default '{}',
  -- sha256 (hex) del token de un solo uso para "Tomarlo".
  action_token_hash text null,
  action_expires_at timestamptz null,
  status text not null default 'pending',
  channels_tried text[] not null default '{}',
  sent_at timestamptz null,
  read_at timestamptz null,
  acted_at timestamptz null,
  created_at timestamptz not null default now(),
  constraint notifications_user_fk
    foreign key (user_id, tenant_id) references public.users (id, tenant_id)
    on delete cascade,
  constraint notifications_kind_check check (
    kind in (
      'turno_apartado', 'turno_oportunidad', 'turno_descartado', 'canal_desconectado', 'sistema'
    )
  ),
  constraint notifications_priority_check check (priority in ('high', 'normal', 'silent')),
  constraint notifications_status_check
    check (status in ('pending', 'sent', 'failed', 'read', 'acted')),
  constraint notifications_title_not_blank check (length(btrim(title)) > 0),
  constraint notifications_payload_is_object check (jsonb_typeof(payload) = 'object'),
  constraint notifications_action_token_hash_format
    check (action_token_hash is null or action_token_hash ~ '^[0-9a-f]{64}$'),
  constraint notifications_action_consistent
    check ((action_token_hash is null) = (action_expires_at is null)),
  constraint notifications_channels_tried_check
    check (channels_tried <@ array['push', 'email', 'telegram']::text[])
);

create index notifications_tenant_created_idx on public.notifications (tenant_id, created_at desc);
create index notifications_user_status_idx on public.notifications (user_id, status);
create unique index notifications_action_token_hash_key
  on public.notifications (action_token_hash) where action_token_hash is not null;

alter table public.notifications enable row level security;

-- ---------------------------------------------------------------------------
-- push_subscriptions (Web Push, una por dispositivo)
-- ---------------------------------------------------------------------------

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  user_id uuid not null,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text null,
  last_success_at timestamptz null,
  created_at timestamptz not null default now(),
  -- Solo usuarios de un tenant (el personal de Ravyn no tiene tenant_id).
  constraint push_subscriptions_user_fk
    foreign key (user_id, tenant_id) references public.users (id, tenant_id)
    on delete cascade,
  constraint push_subscriptions_endpoint_https check (endpoint ~ '^https://'),
  constraint push_subscriptions_keys_not_blank
    check (length(btrim(p256dh)) > 0 and length(btrim(auth)) > 0)
);

create index push_subscriptions_user_id_idx on public.push_subscriptions (user_id);
create index push_subscriptions_tenant_id_idx on public.push_subscriptions (tenant_id);

alter table public.push_subscriptions enable row level security;

-- ---------------------------------------------------------------------------
-- wa_lid_map (LID de WhatsApp a teléfono, por canal)
-- ---------------------------------------------------------------------------

create table public.wa_lid_map (
  channel_id uuid not null,
  lid text not null,
  tenant_id uuid not null,
  phone text null,
  source text not null,
  updated_at timestamptz not null default now(),
  primary key (channel_id, lid),
  constraint wa_lid_map_channel_fk
    foreign key (channel_id, tenant_id) references public.channels (id, tenant_id)
    on delete cascade,
  constraint wa_lid_map_lid_format check (lid ~ '^[0-9]+$'),
  constraint wa_lid_map_phone_format check (phone is null or phone ~ '^[0-9]{8,15}$'),
  constraint wa_lid_map_source_check check (source in ('payload_alt', 'group_metadata', 'manual'))
);

create index wa_lid_map_tenant_id_idx on public.wa_lid_map (tenant_id);

create trigger wa_lid_map_set_updated_at
  before update on public.wa_lid_map
  for each row execute function public.set_updated_at();

alter table public.wa_lid_map enable row level security;
