-- Después de commercial-onboarding.sql e incremental-sync.sql. Aplicación idempotente.
-- Conserva registros, saldos, precios, autorizaciones y pagos. PEN es la moneda heredada.
begin;
alter table public.expenses add column if not exists currency text not null default 'PEN';
do $$ begin
 if not exists(select 1 from pg_constraint where conname='expenses_currency_valid' and conrelid='public.expenses'::regclass) then
  alter table public.expenses add constraint expenses_currency_valid check(currency in ('PEN','USD'));
 end if;
end $$;
create index if not exists finance_user_currency_idx on public.finance_entries(user_id,(coalesce(data->>'currency','PEN')),kind) where not deleted;
create index if not exists finance_user_debt_idx on public.finance_entries(user_id,(data->>'debt_id')) where not deleted;
create index if not exists finance_user_schedule_idx on public.finance_entries(user_id,(data->>'schedule_id')) where not deleted;
create or replace function bap_private.schedule_capacity(d jsonb)
returns numeric language plpgsql immutable set search_path=''
as $$ declare count_i integer := (d->>'installments')::integer; before_i integer := (d->>'paid_before')::integer;
 rate numeric; fixed numeric; principal numeric := (d->>'amount')::numeric; interest numeric; installment numeric; capacity numeric := 0; i integer;
begin
 if d->>'installment_amount' is not null then return round((d->>'installment_amount')::numeric,2)*(count_i-before_i); end if;
 rate:=power(1+(d->>'tea')::numeric/100,1::numeric/12)-1;
 fixed:=case when rate=0 then principal/count_i else principal*rate/(1-power(1+rate,-count_i)) end;
 for i in 1..count_i loop
  interest:=round(principal*rate,2);
  installment:=case when i=count_i then round(principal+interest,2) else round(fixed,2) end;
  principal:=round(principal-(installment-interest),2);
  if i>before_i then capacity:=capacity+installment; end if;
 end loop;
 return capacity;
end $$;
create or replace function bap_private.validate_finance(d jsonb,k text)
returns boolean language plpgsql immutable set search_path=''
as $$ declare v text; dt date; begin
 if coalesce(d->>'currency','PEN') not in ('PEN','USD') or (d?'currency' and jsonb_typeof(d->'currency')<>'string') then return false; end if;
 if jsonb_typeof(d)<>'object' or octet_length(d::text)>16000 then return false; end if;
 if k not in ('income','debt','receivable','payment','disbursement','charge','settings') then return false; end if;
 if k<>'settings' then
  if coalesce(d->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
  dt:=(d->>'date')::date; if dt::text<>d->>'date' then return false; end if;
 end if;
 if coalesce(d->>'due','')<>'' then dt:=(d->>'due')::date; if dt::text<>d->>'due' then return false; end if; end if;
 foreach v in array array['amount','principal','balance','minimum','tea','limit','cut','income','expenses','reserve','emergency','targetMonths','debtPercent','monthly_budget','monthly_base','installment_amount'] loop
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

 if k in ('payment','disbursement','charge') and coalesce(d->>'debt_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
 if d?'schedule_id' and (k<>'payment' or coalesce(d->>'schedule_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then return false; end if;
 if d?'schedule_only' and d->'schedule_only'<>'true'::jsonb then return false; end if;
 if d->'schedule_only'='true'::jsonb then
  if k<>'charge' or jsonb_typeof(d->'name') is distinct from 'string' or length(trim(d->>'name')) not between 1 and 100
  or jsonb_typeof(d->'installments') is distinct from 'number' or (d->>'installments')::numeric not between 1 and 360
  or (d->>'installments')::numeric<>trunc((d->>'installments')::numeric)
  or jsonb_typeof(d->'paid_before') is distinct from 'number' or (d->>'paid_before')::numeric<0
  or (d->>'paid_before')::numeric>=(d->>'installments')::numeric or (d->>'paid_before')::numeric<>trunc((d->>'paid_before')::numeric)
  or coalesce(d->>'first_due','') !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
  dt:=(d->>'first_due')::date; if dt::text<>d->>'first_due' then return false; end if;
  if d->>'tea' is null and d->>'installment_amount' is null then return false; end if;
  if d->>'installment_amount' is not null and ((d->>'installment_amount')::numeric<=0 or round((d->>'installment_amount')::numeric*(d->>'installments')::numeric,2)+0.01<(d->>'amount')::numeric) then return false; end if;
  if d?'expense_id' and coalesce(d->>'expense_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
 end if;
 return true;
exception when others then return false;
end $$;
create or replace function bap_private.validate_entry()
returns trigger language plpgsql security definer set search_path=''
as $$ declare lim integer; total integer; link_kind text; account_data jsonb; schedule_data jsonb; total_paid numeric; begin
 perform pg_advisory_xact_lock(hashtextextended(new.user_id::text,419));
 -- Solo datos del propietario; los roles SQL de servicio también reciben validación.
 if TG_OP='UPDATE' and (new.user_id<>old.user_id or new.id<>old.id) then raise exception 'Propietario e ID inmutables'; end if;
 if TG_TABLE_NAME='expenses' then
  if new.currency not in ('PEN','USD') or new.currency is null then raise exception 'Moneda inválida'; end if;
  if TG_OP='UPDATE' and new.currency is distinct from old.currency then raise exception 'La moneda guardada no se puede cambiar'; end if;
  if length(new.note)>200 or length(new.category) not between 1 and 50 or length(new.payment) not between 1 and 50
  or new.amount<=0 or new.amount>999999999 or octet_length(new.photo)>1048576
  or (new.photo<>'' and new.photo !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$') then raise exception 'Gasto o foto inválidos'; end if;
  if new.credit_id is not null and not new.deleted and not exists(select 1 from public.finance_entries where id=new.credit_id and user_id=new.user_id and kind='debt' and data->>'type'='card' and coalesce(data->>'currency','PEN')=new.currency and not deleted) then raise exception 'Tarjeta vinculada inválida'; end if;
 else
  if not bap_private.validate_finance(new.data,new.kind) then raise exception 'Registro financiero inválido'; end if;

  if TG_OP='UPDATE' and (new.kind<>old.kind or coalesce(new.data->>'currency','PEN')<>coalesce(old.data->>'currency','PEN')) then raise exception 'Tipo y moneda guardados son inmutables'; end if;
  if new.kind='settings' and not new.deleted and exists(select 1 from public.finance_entries where user_id=new.user_id and kind='settings' and not deleted and id<>new.id and coalesce(data->>'currency','PEN')=coalesce(new.data->>'currency','PEN')) then raise exception 'Un presupuesto por moneda'; end if;
  if new.kind in ('payment','disbursement','charge') and not new.deleted then
   select kind,data into link_kind,account_data from public.finance_entries where id=(new.data->>'debt_id')::uuid and user_id=new.user_id and not deleted and kind in ('debt','receivable');

   if link_kind is null or coalesce(account_data->>'currency','PEN')<>coalesce(new.data->>'currency','PEN') then raise exception 'Cuenta vinculada o moneda inválida'; end if;
   if (new.data->>'date')::date<(account_data->>'date')::date then raise exception 'Movimiento anterior al saldo base'; end if;
   if new.data->'schedule_only'='true'::jsonb then
    if link_kind<>'debt' then raise exception 'El cronograma requiere una deuda'; end if;
    if account_data->>'type'='card' then
     if not exists(select 1 from public.expenses e where e.id=(new.data->>'expense_id')::uuid and e.user_id=new.user_id and e.credit_id=(new.data->>'debt_id')::uuid and not e.deleted and e.currency=coalesce(new.data->>'currency','PEN') and e.amount=(new.data->>'amount')::numeric) then raise exception 'Compra de cronograma no disponible o distinta'; end if;
     if exists(select 1 from public.finance_entries f where f.user_id=new.user_id and not f.deleted and f.id<>new.id and f.data->'schedule_only'='true'::jsonb and f.data->>'expense_id'=new.data->>'expense_id') then raise exception 'Compra ya programada'; end if;
    else
     if new.data?'expense_id' then raise exception 'Préstamo sin compra vinculada'; end if;
     if exists(select 1 from public.finance_entries f where f.user_id=new.user_id and not f.deleted and f.id<>new.id and f.data->'schedule_only'='true'::jsonb and f.data->>'debt_id'=new.data->>'debt_id') then raise exception 'Préstamo ya programado'; end if;
    end if;
   end if;
   if new.data?'schedule_id' then
    select data into schedule_data from public.finance_entries where id=(new.data->>'schedule_id')::uuid and user_id=new.user_id and not deleted and kind='charge' and data->'schedule_only'='true'::jsonb and data->>'debt_id'=new.data->>'debt_id' and coalesce(data->>'currency','PEN')=coalesce(new.data->>'currency','PEN');
    if schedule_data is null then raise exception 'Cronograma no disponible'; end if;
    select coalesce(sum((data->>'amount')::numeric),0) into total_paid from public.finance_entries where user_id=new.user_id and not deleted and kind='payment' and id<>new.id and data->>'schedule_id'=new.data->>'schedule_id';
    if total_paid+(new.data->>'amount')::numeric>bap_private.schedule_capacity(schedule_data)+0.01 then raise exception 'El pago excede las cuotas pendientes'; end if;
   end if;
  end if;

  if TG_OP='UPDATE' and old.data->'schedule_only'='true'::jsonb and exists(select 1 from public.finance_entries where user_id=new.user_id and not deleted and kind='payment' and data->>'schedule_id'=new.id::text) and (new.deleted or new.data->'schedule_only' is distinct from old.data->'schedule_only' or (new.data - array['name','note']) is distinct from (old.data - array['name','note'])) then raise exception 'Cronograma con pagos: condiciones protegidas'; end if;
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

revoke all on function bap_private.schedule_capacity(jsonb),bap_private.validate_finance(jsonb,text),bap_private.validate_entry() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
