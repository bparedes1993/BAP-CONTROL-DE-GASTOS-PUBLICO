-- Cursores del servidor: conserva datos, fotos y borrados existentes.
begin;
create table if not exists bap_private.sync_counters (
 user_id uuid primary key references auth.users(id) on delete cascade,
 version bigint not null default 0 check(version>=0)
);
revoke all on bap_private.sync_counters from public,anon,authenticated;
alter table public.expenses add column if not exists sync_version bigint not null default 0;
alter table public.finance_entries add column if not exists sync_version bigint not null default 0;
create index if not exists expenses_user_sync_idx on public.expenses(user_id,sync_version,id);
create index if not exists finance_user_sync_idx on public.finance_entries(user_id,sync_version,id);
create or replace function bap_private.sync_statement_lock()
returns trigger language plpgsql security definer set search_path=''
as $$ begin
 if (select auth.uid()) is not null then
  perform pg_advisory_xact_lock(hashtextextended((select auth.uid())::text,991));
 end if;
 return null;
end $$;
create or replace function bap_private.sync_assign_version()
returns trigger language plpgsql security definer set search_path=''
as $$ begin
 insert into bap_private.sync_counters(user_id,version) values(new.user_id,1)
 on conflict(user_id) do update set version=bap_private.sync_counters.version+1
 returning version into new.sync_version;
 return new;
end $$;
drop trigger if exists bap_sync_statement on public.expenses;
create trigger bap_sync_statement before insert or update on public.expenses for each statement execute function bap_private.sync_statement_lock();
drop trigger if exists bap_sync_statement on public.finance_entries;
create trigger bap_sync_statement before insert or update on public.finance_entries for each statement execute function bap_private.sync_statement_lock();
drop trigger if exists bap_00_sync_version on public.expenses;
create trigger bap_00_sync_version before insert or update on public.expenses for each row execute function bap_private.sync_assign_version();
drop trigger if exists bap_00_sync_version on public.finance_entries;
create trigger bap_00_sync_version before insert or update on public.finance_entries for each row execute function bap_private.sync_assign_version();
create or replace function public.bap_pull_changes(p_kind text,p_version bigint default -1,p_id uuid default '00000000-0000-0000-0000-000000000000',p_limit integer default 5)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare u uuid := bap_private.require_user(); rows jsonb; cursor_version text; cursor_id uuid; size integer;
begin
 if p_kind not in ('expenses','finance') or p_kind is null or p_version is null or p_version < -1 or p_id is null or p_limit is null or p_limit < 1 or p_limit > (case when p_kind='expenses' then 5 else 100 end) then
  raise exception 'Cursor o tamaño de página inválido';
 end if;
 -- El mismo bloqueo de las escrituras impide avanzar sobre cambios sin confirmar.
 perform pg_advisory_xact_lock(hashtextextended(u::text,991));
 if p_kind='expenses' then
  select coalesce(jsonb_agg(to_jsonb(r) order by r.sync_version,r.id),'[]') into rows
  from (select * from public.expenses where user_id=u and (sync_version,id)>(p_version,p_id) order by sync_version,id limit p_limit) r;
 else
  select coalesce(jsonb_agg(to_jsonb(r) order by r.sync_version,r.id),'[]') into rows
  from (select * from public.finance_entries where user_id=u and (sync_version,id)>(p_version,p_id) order by sync_version,id limit p_limit) r;
 end if;
 size:=jsonb_array_length(rows);
 cursor_version:=case when size=0 then p_version::text else rows->(size-1)->>'sync_version' end;
 cursor_id:=case when size=0 then p_id else (rows->(size-1)->>'id')::uuid end;
 return jsonb_build_object('rows',rows,'cursor',jsonb_build_object('version',cursor_version,'id',cursor_id),'more',size=p_limit);
end $$;
revoke all on function bap_private.sync_statement_lock(),bap_private.sync_assign_version(),public.bap_pull_changes(text,bigint,uuid,integer) from public,anon,authenticated;
grant execute on function public.bap_pull_changes(text,bigint,uuid,integer) to authenticated;
commit;
