-- Semilla de desarrollo (solo local; nunca se aplica en producción).
-- Un tenant de prueba y dos usuarios:
--   owner@example.com  / ravyn-dev-123  -> tenant_owner del tenant dr-demo
--   admin@example.com  / ravyn-dev-123  -> ravyn_admin (sin tenant)
-- Los UUID son fijos para que las pruebas de integración puedan referenciarlos.

insert into public.tenants (id, slug, name, status, modules_enabled, config, timezone)
values (
  '00000000-0000-4000-a000-000000000001',
  'dr-demo',
  'Consultorio de prueba',
  'active',
  '{}',
  '{}',
  'America/Matamoros'
);

-- Usuarios de Supabase Auth. Los campos de token van en '' (no NULL) porque GoTrue
-- falla al leer filas con NULL en esas columnas.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-b000-000000000001',
    'authenticated', 'authenticated', 'owner@example.com',
    extensions.crypt('ravyn-dev-123', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now(),
    '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-b000-000000000002',
    'authenticated', 'authenticated', 'admin@example.com',
    extensions.crypt('ravyn-dev-123', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now(),
    '', '', '', ''
  );

insert into auth.identities (
  id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
)
select
  gen_random_uuid(),
  u.id,
  u.id::text,
  'email',
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  now(), now(), now()
from auth.users u
where u.id in ('00000000-0000-4000-b000-000000000001', '00000000-0000-4000-b000-000000000002');

insert into public.users (id, tenant_id, full_name, role, email)
values
  (
    '00000000-0000-4000-b000-000000000001',
    '00000000-0000-4000-a000-000000000001',
    'Doctor de prueba', 'tenant_owner', 'owner@example.com'
  ),
  (
    '00000000-0000-4000-b000-000000000002',
    null,
    'Admin Ravyn', 'ravyn_admin', 'admin@example.com'
  );
