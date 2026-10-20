-- Después de commercial-onboarding.sql. No activa medios ni crea pagos.
begin;
create table if not exists public.bap_checkout_methods (
 method text primary key check(method in ('yape','plin','transfer')),
 enabled boolean not null default false,
 payee text not null default '', phone text not null default '',
 bank text not null default '', account text not null default '', cci text not null default '',
 instructions text not null default '', qr text not null default '',
 revision integer not null default 0, updated_at timestamptz not null default now(),
 check(length(payee)<=100 and length(phone)<=9 and length(bank)<=80 and length(account)<=24 and length(cci)<=20 and length(instructions)<=240 and length(qr)<=131072)
);
insert into public.bap_checkout_methods(method) values('yape'),('plin'),('transfer') on conflict do nothing;
alter table public.bap_checkout_methods enable row level security;
revoke all on public.bap_checkout_methods from public,anon,authenticated;
alter table public.bap_access add column if not exists requested_method text;
alter table public.bap_access add column if not exists requested_reference text not null default '';
alter table public.bap_access add column if not exists requested_method_revision integer;
alter table public.bap_access add column if not exists requested_price_pen numeric(12,2);

create or replace function public.bap_checkout()
returns jsonb language plpgsql stable security definer set search_path=''
as $$ declare u uuid := bap_private.require_user(); begin
 return (select coalesce(jsonb_agg(to_jsonb(m) order by m.method),'[]') from public.bap_checkout_methods m where m.enabled);
end $$;
create or replace function public.bap_admin_checkout_methods()
returns jsonb language plpgsql stable security definer set search_path=''
as $$ declare actor uuid := bap_private.require_admin(); begin
 return (select coalesce(jsonb_agg(to_jsonb(m) order by m.method),'[]') from public.bap_checkout_methods m);
end $$;
create or replace function public.bap_admin_save_checkout(p_method text,p_data jsonb,p_revision integer)
returns jsonb language plpgsql security definer set search_path=''
as $$ declare actor uuid := bap_private.require_admin(); previous public.bap_checkout_methods;
 k text; name_v text; phone_v text; bank_v text; account_v text; cci_v text; instructions_v text; qr_v text; enabled_v boolean;
begin
 if p_method is null or p_method not in ('yape','plin','transfer') or p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>140000 or p_revision is null then raise exception 'Medio de cobro inválido'; end if;
 if jsonb_typeof(p_data->'enabled') is distinct from 'boolean' then raise exception 'Estado del medio requerido'; end if;
 foreach k in array array['payee','phone','bank','account','cci','instructions','qr'] loop
  if p_data?k and jsonb_typeof(p_data->k)<>'string' then raise exception 'Datos de cobro inválidos'; end if;
 end loop;
 enabled_v:=(p_data->>'enabled')::boolean;
 name_v:=trim(coalesce(p_data->>'payee','')); phone_v:=trim(coalesce(p_data->>'phone',''));
 bank_v:=trim(coalesce(p_data->>'bank','')); account_v:=trim(coalesce(p_data->>'account','')); cci_v:=trim(coalesce(p_data->>'cci',''));
 instructions_v:=trim(coalesce(p_data->>'instructions','')); qr_v:=coalesce(p_data->>'qr','');
 if length(name_v)>100 or length(bank_v)>80 or length(instructions_v)>240
 or (phone_v<>'' and phone_v !~ '^9[0-9]{8}$') or (account_v<>'' and account_v !~ '^[0-9]{6,24}$') or (cci_v<>'' and cci_v !~ '^[0-9]{20}$') then raise exception 'Revisa titular, teléfono o cuenta'; end if;
 if length(qr_v)>131072 or (qr_v<>'' and (qr_v !~ '^data:image/png;base64,[A-Za-z0-9+/=]+$' or substring(decode(split_part(qr_v,',',2),'base64') from 1 for 8)<>decode('89504e470d0a1a0a','hex'))) then raise exception 'QR inválido: usa una imagen PNG procesada por BAP'; end if;
 if enabled_v and (name_v='' or (p_method in ('yape','plin') and phone_v='' and qr_v='') or (p_method='transfer' and (bank_v='' or (account_v='' and cci_v='')))) then raise exception 'Completa el titular y el destino antes de activar'; end if;
 select * into previous from public.bap_checkout_methods where method=p_method for update;
 if previous.method is null or previous.revision<>p_revision then raise exception 'Otra sesión actualizó este medio; vuelve a cargarlo'; end if;
 update public.bap_checkout_methods set enabled=enabled_v,payee=name_v,phone=phone_v,bank=bank_v,account=account_v,cci=cci_v,instructions=instructions_v,qr=qr_v,revision=revision+1,updated_at=now() where method=p_method;
 insert into public.bap_audit(id,actor_id,action,detail) values(gen_random_uuid(),actor,'checkout_method',jsonb_build_object('method',p_method,'enabled',enabled_v,'revision',previous.revision+1));
 return (select to_jsonb(m) from public.bap_checkout_methods m where method=p_method);
end $$;

create or replace function public.bap_my_access()
returns jsonb language plpgsql stable security definer set search_path=''
as $$ declare u uuid := bap_private.require_user(); a public.bap_access; begin
 select * into a from public.bap_access where user_id=u;
 return jsonb_build_object('is_admin',bap_private.is_admin(),'admin_verified',bap_private.is_admin() and coalesce((select auth.jwt())->>'aal','aal1')='aal2',
 'enforcement',(select enforcement from public.bap_commercial_settings where id),
 'can_write',public.bap_can_write(),'status',case when a.status='active' and a.ends_at<=now() then 'expired' else coalesce(a.status,'not_requested') end,
 'plan_id',a.plan_id,'requested_plan',a.requested_plan,'starts_at',a.starts_at,'ends_at',a.ends_at,'server_now',now(),
 'requested_method',a.requested_method,'requested_reference',a.requested_reference,'requested_method_revision',a.requested_method_revision,'requested_price_pen',a.requested_price_pen,
 'features',jsonb_build_object('currencies',true,'checkout',true),
 'plans',(select coalesce(jsonb_agg(to_jsonb(p) order by p.days),'[]') from public.bap_plans p where p.published),
 'payments',(select coalesce(jsonb_agg(to_jsonb(p) order by p.paid_at desc),'[]') from (select id,amount_pen,method,reference,paid_at from public.bap_payments where user_id=u order by paid_at desc limit 20) p));
end $$;
-- Retains legacy clients without carrying a reference over to a different request.
create or replace function public.bap_request_access(p_plan text)
returns jsonb language plpgsql security definer set search_path=''
as $$ declare u uuid := bap_private.require_user(); a public.bap_access; begin
 perform pg_advisory_xact_lock(hashtextextended(u::text,417));
 if not exists(select 1 from public.bap_plans where id=p_plan and published) then raise exception 'Plan no disponible'; end if;
 select * into a from public.bap_access where user_id=u for update;
 if a.status='suspended' or a.status='rejected' then raise exception 'Contacta al soporte para revisar tu solicitud'; end if;
 if a.status='active' and a.ends_at>now() then raise exception 'Tu acceso sigue vigente; contacta al soporte para renovar'; end if;
 if a.requested_plan is not null and a.requested_at>now()-interval '10 minutes' then raise exception 'Ya recibimos tu solicitud; espera antes de actualizarla'; end if;
 insert into public.bap_access(user_id,requested_plan,status,last_seen_at) values(u,p_plan,'pending',now())
 on conflict(user_id) do update set requested_plan=p_plan,status='pending',requested_at=now(),updated_at=now(),requested_method=null,requested_reference='',requested_method_revision=null,requested_price_pen=null;
 insert into public.bap_audit(id,actor_id,user_id,action,detail) values(gen_random_uuid(),u,u,'request',jsonb_build_object('plan',p_plan));
 return public.bap_my_access();
end $$;
create or replace function public.bap_request_access_with_payment(p_plan text,p_method text,p_reference text default '',p_revision integer default null)
returns jsonb language plpgsql security definer set search_path=''
as $$ declare u uuid := bap_private.require_user(); m public.bap_checkout_methods; a public.bap_access; price numeric; begin
 perform pg_advisory_xact_lock(hashtextextended(u::text,417));
 if p_method is null or p_method not in ('yape','plin','transfer') or p_reference is null or length(p_reference)>100 or p_revision is null then raise exception 'Selecciona un medio de pago disponible'; end if;
 select * into m from public.bap_checkout_methods where method=p_method and enabled for share;
 if m.method is null or m.revision<>p_revision then raise exception 'El medio de pago cambió: actualiza Mi acceso antes de enviar'; end if;
 select * into a from public.bap_access where user_id=u;
 if a.status='pending' and a.requested_plan=p_plan and a.requested_method=p_method and a.requested_reference=trim(p_reference) and a.requested_method_revision=p_revision and a.requested_at>now()-interval '10 minutes' then return public.bap_my_access(); end if;
 perform public.bap_request_access(p_plan);
 select price_pen into price from public.bap_plans where id=p_plan and published;
 update public.bap_access set requested_method=p_method,requested_reference=trim(p_reference),requested_method_revision=p_revision,requested_price_pen=price where user_id=u;
 insert into public.bap_audit(id,actor_id,user_id,action,detail) values(gen_random_uuid(),u,u,'payment_preference',jsonb_build_object('plan',p_plan,'method',p_method,'revision',p_revision,'price_pen',price));
 return public.bap_my_access();
end $$;
revoke all on function public.bap_checkout(),public.bap_admin_checkout_methods(),public.bap_admin_save_checkout(text,jsonb,integer),public.bap_request_access_with_payment(text,text,text,integer),public.bap_my_access(),public.bap_request_access(text) from public,anon,authenticated;
grant execute on function public.bap_checkout(),public.bap_admin_checkout_methods(),public.bap_admin_save_checkout(text,jsonb,integer),public.bap_request_access_with_payment(text,text,text,integer),public.bap_my_access(),public.bap_request_access(text) to authenticated;
notify pgrst,'reload schema';
commit;
