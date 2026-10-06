-- BAP: ejecutar completo después de finance.sql. No asigna administradores.
-- Conserva el piloto hasta activar enforcement desde un administrador con MFA.
begin;
create schema if not exists bap_private;
revoke all on schema bap_private from public, anon, authenticated;
create table if not exists public.bap_commercial_settings (
 id boolean primary key default true check(id),
 enforcement boolean not null default false,
 updated_at timestamptz not null default now()
);
insert into public.bap_commercial_settings(id) values(true) on conflict do nothing;
create table if not exists public.bap_admins (
 user_id uuid primary key references auth.users(id) on delete cascade,
 created_at timestamptz not null default now()
);
create table if not exists public.bap_plans (
 id text primary key check(id ~ '^[a-z0-9_]{1,30}$'),
 name text not null check(length(name) between 1 and 60),
 days integer not null check(days between 1 and 730),
 price_pen numeric(10,2) check(price_pen between 0 and 100000),
 published boolean not null default true,
 max_expenses integer not null default 5000 check(max_expenses between 1 and 50000),
 max_finance integer not null default 5000 check(max_finance between 1 and 50000)
);
insert into public.bap_plans(id,name,days) values
 ('monthly','Personal mensual',30),('semiannual','Personal semestral',180),('annual','Personal anual',365)
 on conflict do nothing;
create table if not exists public.bap_access (
 user_id uuid primary key references auth.users(id) on delete cascade,
 requested_plan text references public.bap_plans(id),
 plan_id text references public.bap_plans(id),
 status text not null default 'pending' check(status in ('pending','active','suspended','rejected')),
 starts_at timestamptz,
 ends_at timestamptz,
 requested_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(ends_at is null or (starts_at is not null and ends_at > starts_at))
);
create table if not exists public.bap_payments (
 id uuid primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 amount_pen numeric(10,2) not null check(amount_pen > 0 and amount_pen <= 100000),
 method text not null check(method in ('transfer','yape','plin','cash','other')),
 reference text not null check(length(reference) between 1 and 100),
 paid_at timestamptz not null default now(),
 recorded_by uuid references auth.users(id) on delete set null,
 unique(method,reference)
);
create table if not exists public.bap_audit (
 id uuid primary key,
 actor_id uuid references auth.users(id) on delete set null,
 user_id uuid references auth.users(id) on delete cascade,
 action text not null,
 detail jsonb not null,
 created_at timestamptz not null default now()
);
create index if not exists bap_access_status_idx on public.bap_access(status,requested_at desc);
create index if not exists bap_payments_user_idx on public.bap_payments(user_id,paid_at desc);
create index if not exists bap_audit_created_idx on public.bap_audit(created_at desc);
-- Sin permisos directos de escritura: todas las decisiones pasan por RPC verificadas.
alter table public.bap_admins enable row level security;
alter table public.bap_commercial_settings enable row level security;
alter table public.bap_plans enable row level security;
alter table public.bap_access enable row level security;
alter table public.bap_payments enable row level security;
alter table public.bap_audit enable row level security;
revoke all on public.bap_admins,public.bap_commercial_settings,public.bap_plans,public.bap_access,public.bap_payments,public.bap_audit from public,anon,authenticated;

create or replace function bap_private.is_admin()
returns boolean language sql stable security definer set search_path=''
as $$ select exists(select 1 from public.bap_admins where user_id=(select auth.uid())) $$;
create or replace function bap_private.require_user()
returns uuid language plpgsql stable security definer set search_path=''
as $$ declare u uuid := (select auth.uid()); begin
 if u is null or not exists(select 1 from auth.users where id=u and email_confirmed_at is not null) then
  raise exception 'Correo verificado requerido' using errcode='42501';
 end if;
 return u;
end $$;
create or replace function bap_private.require_admin()
returns uuid language plpgsql stable security definer set search_path=''
as $$ declare u uuid := bap_private.require_user(); begin
 if not bap_private.is_admin() or coalesce((select auth.jwt())->>'aal','aal1') <> 'aal2' then
  raise exception 'Administrador con segundo factor requerido' using errcode='42501';
 end if;
 return u;
end $$;
create or replace function public.bap_can_write()
returns boolean language sql stable security definer set search_path=''
as $$ select (select auth.uid()) is not null and (
 not coalesce((select enforcement from public.bap_commercial_settings where id),true)
 or (bap_private.is_admin() and coalesce((select auth.jwt())->>'aal','aal1')='aal2')
 or exists(select 1 from public.bap_access where user_id=(select auth.uid())
  and status='active' and starts_at<=now() and ends_at>now())) $$;
create or replace function public.bap_my_access()
returns jsonb language plpgsql stable security definer set search_path=''
as $$ declare u uuid := bap_private.require_user(); a public.bap_access; begin
 select * into a from public.bap_access where user_id=u;
 return jsonb_build_object('is_admin',bap_private.is_admin(),'admin_verified',bap_private.is_admin() and coalesce((select auth.jwt())->>'aal','aal1')='aal2',
 'enforcement',(select enforcement from public.bap_commercial_settings where id),
 'can_write',public.bap_can_write(),'status',case when a.status='active' and a.ends_at<=now() then 'expired' else coalesce(a.status,'not_requested') end,
 'plan_id',a.plan_id,'requested_plan',a.requested_plan,'starts_at',a.starts_at,'ends_at',a.ends_at,'server_now',now(),
 'plans',(select coalesce(jsonb_agg(to_jsonb(p) order by p.days),'[]') from public.bap_plans p where p.published),
 'payments',(select coalesce(jsonb_agg(to_jsonb(p) order by p.paid_at desc),'[]') from (select id,amount_pen,method,reference,paid_at from public.bap_payments where user_id=u order by paid_at desc limit 20) p));
end $$;
create or replace function public.bap_request_access(p_plan text)
returns jsonb language plpgsql security definer set search_path=''
as $$ declare u uuid := bap_private.require_user(); a public.bap_access; begin
 perform pg_advisory_xact_lock(hashtextextended(u::text,417));
 if not exists(select 1 from public.bap_plans where id=p_plan and published) then raise exception 'Plan no disponible'; end if;
 select * into a from public.bap_access where user_id=u for update;
 if a.status='suspended' or a.status='rejected' then raise exception 'Contacta al soporte para revisar tu solicitud'; end if;
 if a.status='active' and a.ends_at>now() then raise exception 'Tu acceso sigue vigente; contacta al soporte para renovar'; end if;
 if a.user_id is not null and a.requested_at>now()-interval '10 minutes' then raise exception 'Ya recibimos tu solicitud; espera antes de actualizarla'; end if;
 insert into public.bap_access(user_id,requested_plan,status) values(u,p_plan,'pending')
 on conflict(user_id) do update set requested_plan=p_plan,status='pending',requested_at=now(),updated_at=now();
 insert into public.bap_audit(id,actor_id,user_id,action,detail) values(gen_random_uuid(),u,u,'request',jsonb_build_object('plan',p_plan));
 return public.bap_my_access();
end $$;
create or replace function public.bap_admin_list(p_offset integer default 0,p_search text default '')
returns jsonb language plpgsql stable security definer set search_path=''
as $$ declare actor uuid := bap_private.require_admin(); begin
 if p_offset<0 or p_offset>100000 or length(p_search)>100 then raise exception 'Consulta inválida'; end if;
 return jsonb_build_object('customers',(select coalesce(jsonb_agg(to_jsonb(q)),'[]') from (
 select a.*,u.email,case when a.status='active' and a.ends_at<=now() then 'expired' else a.status end effective_status
 from public.bap_access a join auth.users u on u.id=a.user_id
 where u.email ilike '%' || replace(replace(replace(p_search,'\','\\'),'%','\%'),'_','\_') || '%' escape '\'
 order by a.requested_at desc,a.user_id limit 50 offset p_offset) q),
 'plans',(select coalesce(jsonb_agg(to_jsonb(p) order by p.days),'[]') from public.bap_plans p),
 'enforcement',(select enforcement from public.bap_commercial_settings where id),
 'audit',(select coalesce(jsonb_agg(to_jsonb(q)),'[]') from (select action,detail,created_at from public.bap_audit order by created_at desc limit 30) q));
end $$;
create or replace function public.bap_admin_decide(p_operation uuid,p_user uuid,p_status text,p_plan text,p_days integer,p_amount numeric default 0,p_method text default 'other',p_reference text default '')
returns jsonb language plpgsql security definer set search_path=''
as $$ declare actor uuid := bap_private.require_admin(); a public.bap_access; start_time timestamptz; end_time timestamptz; begin
 perform pg_advisory_xact_lock(hashtextextended(p_operation::text,418));
 if exists(select 1 from public.bap_audit where id=p_operation and actor_id=actor and user_id=p_user and action='decision') then
  return jsonb_build_object('ok',true,'duplicate',true);
 end if;
 if p_operation is null or p_user is null or p_status not in ('active','suspended','rejected') or p_status is null
 or p_amount is null or p_amount<0 or p_amount>100000 or p_amount<>round(p_amount,2) then raise exception 'Decisión inválida'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,417));
 select * into a from public.bap_access where user_id=p_user for update;
 if a.user_id is null then raise exception 'El cliente debe enviar una solicitud'; end if;
 if p_status='active' then
  if p_days is null or p_days<1 or p_days>730 or not exists(select 1 from public.bap_plans where id=p_plan) then raise exception 'Plan y vigencia inválidos'; end if;
  start_time:=case when a.status='active' and a.ends_at>now() then a.starts_at else now() end;
  end_time:=greatest(case when a.status='active' then a.ends_at else null end,now())+make_interval(days=>p_days);
 else start_time:=a.starts_at; end_time:=a.ends_at;
  if p_amount>0 then raise exception 'Registra pagos únicamente al aprobar o renovar'; end if;
 end if;
 if p_amount>0 then
  if p_method not in ('transfer','yape','plin','cash','other') or length(trim(p_reference)) not between 1 and 100 then raise exception 'Referencia de pago requerida'; end if;
  insert into public.bap_payments(id,user_id,amount_pen,method,reference,recorded_by) values(p_operation,p_user,p_amount,p_method,trim(p_reference),actor);
 end if;
 update public.bap_access set status=p_status,plan_id=case when p_status='active' then p_plan else plan_id end,starts_at=start_time,ends_at=end_time,updated_at=now() where user_id=p_user;
 insert into public.bap_audit(id,actor_id,user_id,action,detail) values(p_operation,actor,p_user,'decision',jsonb_build_object('status',p_status,'plan',p_plan,'ends_at',end_time,'amount_pen',p_amount));
 return jsonb_build_object('ok',true,'ends_at',end_time);
end $$;
create or replace function public.bap_admin_plan(p_id text,p_name text,p_price numeric,p_days integer,p_published boolean)
returns void language plpgsql security definer set search_path=''
as $$ declare actor uuid := bap_private.require_admin(); begin
 update public.bap_plans set name=trim(p_name),price_pen=p_price,days=p_days,published=p_published where id=p_id;
 if not found then raise exception 'Plan no encontrado'; end if;
 insert into public.bap_audit(id,actor_id,action,detail) values(gen_random_uuid(),actor,'plan',jsonb_build_object('plan',p_id,'price_pen',p_price,'days',p_days));
end $$;
create or replace function public.bap_admin_enforcement(p_enabled boolean)
returns void language plpgsql security definer set search_path=''
as $$ declare actor uuid := bap_private.require_admin(); begin
 if p_enabled is null then raise exception 'Estado requerido'; end if;
 update public.bap_commercial_settings set enforcement=p_enabled,updated_at=now() where id;
 insert into public.bap_audit(id,actor_id,action,detail) values(gen_random_uuid(),actor,'enforcement',jsonb_build_object('enabled',p_enabled));
end $$;
-- Política RESTRICTIVE adicional: no elimina las reglas de propiedad existentes.
drop policy if exists bap_expenses_write_gate on public.expenses;
create policy bap_expenses_write_gate on public.expenses as restrictive for insert to authenticated with check((select public.bap_can_write()));
drop policy if exists bap_expenses_update_gate on public.expenses;
create policy bap_expenses_update_gate on public.expenses as restrictive for update to authenticated using((select public.bap_can_write())) with check((select public.bap_can_write()));
drop policy if exists bap_finance_write_gate on public.finance_entries;
create policy bap_finance_write_gate on public.finance_entries as restrictive for insert to authenticated with check((select public.bap_can_write()));
drop policy if exists bap_finance_update_gate on public.finance_entries;
create policy bap_finance_update_gate on public.finance_entries as restrictive for update to authenticated using((select public.bap_can_write())) with check((select public.bap_can_write()));
-- Validación y cuotas para escrituras directas a la API, incluso si se omite la web.
create or replace function bap_private.validate_finance(d jsonb,k text)
returns boolean language plpgsql immutable set search_path=''
as $$ declare v text; dt date; begin
 if jsonb_typeof(d)<>'object' or octet_length(d::text)>16000 then return false; end if;
 if k not in ('income','debt','receivable','payment','disbursement','charge','settings') then return false; end if;
 if k<>'settings' then
  if coalesce(d->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
  dt:=(d->>'date')::date; if dt::text<>d->>'date' then return false; end if;
 end if;
 if coalesce(d->>'due','')<>'' then dt:=(d->>'due')::date; if dt::text<>d->>'due' then return false; end if; end if;
 foreach v in array array['amount','principal','balance','minimum','tea','limit','cut','income','expenses','reserve','emergency','targetMonths','debtPercent'] loop
  if d?v and d->v<>'null'::jsonb then
   if jsonb_typeof(d->v)<>'number' or (d->>v)::numeric<0 or (d->>v)::numeric>999999999 then return false; end if;
  end if;
 end loop;
 if k in ('income','debt','receivable') and (jsonb_typeof(d->'name') is distinct from 'string' or length(trim(d->>'name')) not between 1 and 100) then return false; end if;
 if k in ('income','payment','disbursement','charge') and coalesce((d->>'amount')::numeric,0)<=0 then return false; end if;
 if k in ('debt','receivable') and (d->'balance' is null or d->'balance'='null'::jsonb) then return false; end if;
 if (d->>'principal')::numeric>(d->>'amount')::numeric or (d->>'tea')::numeric>2000 or (d->>'debtPercent')::numeric>100 then return false; end if;
 if d->>'cut' is not null and ((d->>'cut')::numeric<>trunc((d->>'cut')::numeric) or (d->>'cut')::numeric not between 1 and 31) then return false; end if;
 if d->>'targetMonths' is not null and ((d->>'targetMonths')::numeric<>trunc((d->>'targetMonths')::numeric) or (d->>'targetMonths')::numeric>24) then return false; end if;
 if d->>'note' is not null and (jsonb_typeof(d->'note')<>'string' or length(d->>'note')>200) then return false; end if;
 return true;
exception when others then return false;
end $$;
create or replace function bap_private.validate_entry()
returns trigger language plpgsql security definer set search_path=''
as $$ declare lim integer; total integer; link_kind text; begin
 -- Solo datos del propietario; los roles SQL de servicio también reciben validación.
 if TG_OP='UPDATE' and (new.user_id<>old.user_id or new.id<>old.id) then raise exception 'Propietario e ID inmutables'; end if;
 if TG_TABLE_NAME='expenses' then
  if length(new.note)>200 or length(new.category) not between 1 and 50 or length(new.payment) not between 1 and 50
  or new.amount<=0 or new.amount>999999999 or octet_length(new.photo)>1048576
  or (new.photo<>'' and new.photo !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$') then raise exception 'Gasto o foto inválidos'; end if;
  if new.credit_id is not null and not new.deleted and not exists(select 1 from public.finance_entries where id=new.credit_id and user_id=new.user_id and kind='debt' and data->>'type'='card' and not deleted) then raise exception 'Tarjeta vinculada inválida'; end if;
 else
  if not bap_private.validate_finance(new.data,new.kind) then raise exception 'Registro financiero inválido'; end if;
  if new.kind='settings' and new.id<>new.user_id then raise exception 'Un presupuesto por cuenta'; end if;
  if new.kind in ('payment','disbursement','charge') and not new.deleted then
   select kind into link_kind from public.finance_entries where id=(new.data->>'debt_id')::uuid and user_id=new.user_id and not deleted and kind in ('debt','receivable');
   if link_kind is null then raise exception 'Cuenta vinculada inválida'; end if;
  end if;
  if TG_OP='UPDATE' and old.kind in ('debt','receivable') and (new.deleted or new.kind<>old.kind or new.data->>'type' is distinct from old.data->>'type') and (
   exists(select 1 from public.finance_entries where user_id=new.user_id and data->>'debt_id'=new.id::text and not deleted)
   or exists(select 1 from public.expenses where user_id=new.user_id and credit_id=new.id and not deleted)) then raise exception 'Cuenta con movimientos vinculados'; end if;
 end if;
 if TG_OP='INSERT' then
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text,419));
  select case when TG_TABLE_NAME='expenses' then p.max_expenses else p.max_finance end into lim from public.bap_access a join public.bap_plans p on p.id=a.plan_id where a.user_id=new.user_id;
  lim:=coalesce(lim,5000);
  if TG_TABLE_NAME='expenses' then select count(*) into total from public.expenses where user_id=new.user_id;
  else select count(*) into total from public.finance_entries where user_id=new.user_id; end if;
  if total>=lim then raise exception 'Límite de registros alcanzado; contacta al soporte'; end if;
 end if;
 return new;
end $$;
drop trigger if exists bap_expense_validation on public.expenses;
create trigger bap_expense_validation before insert or update on public.expenses for each row execute function bap_private.validate_entry();
drop trigger if exists bap_finance_validation on public.finance_entries;
create trigger bap_finance_validation before insert or update on public.finance_entries for each row execute function bap_private.validate_entry();
-- Revocar la ejecución implícita que PostgreSQL concede a PUBLIC.
revoke all on all functions in schema bap_private from public,anon,authenticated;
revoke all on function public.bap_can_write(),public.bap_my_access(),public.bap_request_access(text),public.bap_admin_list(integer,text),public.bap_admin_decide(uuid,uuid,text,text,integer,numeric,text,text),public.bap_admin_plan(text,text,numeric,integer,boolean),public.bap_admin_enforcement(boolean) from public,anon,authenticated;
grant execute on function public.bap_can_write(),public.bap_my_access(),public.bap_request_access(text),public.bap_admin_list(integer,text),public.bap_admin_decide(uuid,uuid,text,text,integer,numeric,text,text),public.bap_admin_plan(text,text,numeric,integer,boolean),public.bap_admin_enforcement(boolean) to authenticated;
commit;
