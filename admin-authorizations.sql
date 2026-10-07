-- Autorizaciones administrativas de un solo uso. Ejecutar después de commercial.sql.
begin;
create table if not exists bap_private.admin_authorizations (
 email text primary key check(email=lower(btrim(email)) and length(email) between 3 and 254),
 approved_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '30 days',
 claimed_at timestamptz,
 claimed_by uuid references auth.users(id) on delete set null,
 revoked boolean not null default false
);
revoke all on bap_private.admin_authorizations from public,anon,authenticated;
create or replace function public.bap_claim_admin_authorization()
returns jsonb language plpgsql security definer set search_path=''
as $$
declare u uuid := bap_private.require_user(); address text; approval bap_private.admin_authorizations;
begin
 select lower(email) into address from auth.users where id=u and email_confirmed_at is not null;
 select * into approval from bap_private.admin_authorizations where email=address for update;
 if not found or approval.revoked or approval.claimed_at is not null or approval.expires_at<=now() then
  return jsonb_build_object('claimed',false);
 end if;
 insert into public.bap_admins(user_id) values(u) on conflict do nothing;
 update bap_private.admin_authorizations set claimed_at=now(),claimed_by=u where email=address;
 insert into public.bap_audit(id,actor_id,user_id,action,detail)
 values(gen_random_uuid(),u,u,'admin_authorization_claimed',jsonb_build_object('role','commercial','mfa_required',true));
 return jsonb_build_object('claimed',true);
end $$;
revoke all on function public.bap_claim_admin_authorization() from public,anon,authenticated;
grant execute on function public.bap_claim_admin_authorization() to authenticated;
commit;
