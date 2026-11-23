-- Quita a anon y authenticated todo privilegio sobre el esquema public (hallazgo de T0.8).
--
-- Supabase concede ALL a anon y authenticated en las tablas nuevas de public. RLS sin
-- políticas bloquea SELECT, INSERT, UPDATE y DELETE, pero no TRUNCATE (ni REFERENCES ni
-- TRIGGER): con la anon key pública, cualquiera podía vaciar una tabla por PostgREST.
--
-- En la fase 0 y la fase 1 nada usa esos roles contra tablas: el servidor usa la service role
-- y el navegador solo usa Auth. Cuando la fase 2 agregue políticas por tenant (Realtime),
-- cada tabla que se exponga recibirá un GRANT explícito y mínimo junto con su política.
-- check-rls falla si anon o authenticated tienen cualquier privilegio en public.

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated, public;

-- Y lo mismo para lo que creen las migraciones futuras (corren como postgres).
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated, public;
