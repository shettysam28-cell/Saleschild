-- Member pilot foundation. Apply only through the approved migration workflow.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

alter table public.memberships
  add column lifecycle text not null default 'active' check(lifecycle in('active','provisioned','setup_required','revoked')),
  add column password_change_required boolean not null default false,
  add column credential_version integer not null default 0 check(credential_version >= 0),
  add column access_not_before bigint not null default 0 check(access_not_before>=0),
  add column setup_not_before bigint not null default 0 check(setup_not_before>=0),
  add column credential_expires_at timestamptz,
  add column first_login_at timestamptz,
  add column last_seen_at timestamptz,
  add column revoked_at timestamptz;

-- Revocation is checked against current trusted membership data on every query,
-- including requests carrying an older, still cryptographically valid JWT.
create function private.member_session_is_current(required_epoch bigint) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare session_text text; valid boolean:=false;
begin
  if required_epoch=0 then return true; end if;
  session_text:=nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id';
  if (select auth.uid()) is null or session_text is null or session_text !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    or to_regclass('auth.sessions') is null then return false; end if;
  -- A refreshed JWT's iat is not evidence of a fresh password sign-in. Check
  -- the original trusted Auth session creation time, not user/JWT metadata.
  execute 'select exists(select 1 from auth.sessions where id=$1 and user_id=$2 and created_at>=to_timestamp($3))'
    into valid using session_text::uuid,auth.uid(),required_epoch;
  return valid;
end; $$;
revoke all on function private.member_session_is_current(bigint) from public,anon,authenticated;
create or replace function private.membership_role(org_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select role from public.memberships
  where organization_id=org_id and user_id=(select auth.uid())
    and (select auth.uid()) is not null
    and exists(select 1 from auth.users u where u.id=(select auth.uid()) and u.email_confirmed_at is not null)
    and lifecycle='active' and not password_change_required and revoked_at is null
    and (access_not_before=0 or access_not_before<=coalesce((nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'iat')::bigint,0))
    and private.member_session_is_current(access_not_before);
$$;

create function private.workspace_session_current(org_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select (select auth.uid()) is not null and private.membership_role(org_id) is not null; $$;
create function public.workspace_session_current(org_id uuid) returns boolean
language sql security invoker set search_path = '' as $$ select private.workspace_session_current(org_id); $$;
revoke all on function private.workspace_session_current(uuid),public.workspace_session_current(uuid) from public,anon;
grant execute on function private.workspace_session_current(uuid),public.workspace_session_current(uuid) to authenticated;

alter policy organization_update on public.organizations using((select private.membership_role(id))='owner') with check((select private.membership_role(id))='owner');

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check(char_length(btrim(display_name)) between 1 and 100),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
revoke all on public.profiles from public,anon,authenticated;
grant select on public.profiles to authenticated;
grant insert(user_id,display_name),update(display_name) on public.profiles to authenticated;
create policy profile_read on public.profiles for select to authenticated using(
  user_id=(select auth.uid()) or exists(
    select 1 from public.memberships m where m.user_id=profiles.user_id
      and (select private.membership_role(m.organization_id))='owner'
  )
);
create policy profile_insert on public.profiles for insert to authenticated with check(user_id=(select auth.uid()));
create policy profile_update on public.profiles for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));

create table public.member_provisioning (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id),
  user_id uuid references auth.users(id),
  email text not null check(char_length(email) between 3 and 254 and email=lower(btrim(email)) and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  display_name text not null check(char_length(btrim(display_name)) between 1 and 100),
  state text not null default 'reserved' check(state in('reserved','awaiting_verification','provisioned','active','revoked','failed')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  credential_expires_at timestamptz,
  unique(organization_id,id)
);
create unique index member_email_live on public.member_provisioning(organization_id,email) where state not in('revoked','failed');
create unique index member_identity_live on public.member_provisioning(organization_id,user_id) where state not in('revoked','failed');
create index member_provisioning_org on public.member_provisioning(organization_id,state);
alter table public.member_provisioning enable row level security;
revoke all on public.member_provisioning from public,anon,authenticated;
grant select on public.member_provisioning to authenticated;
create policy member_provisioning_owner_read on public.member_provisioning for select to authenticated using((select private.membership_role(organization_id))='owner');

create function private.member_preparation_status() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from auth.users u join public.member_provisioning p
    on p.id::text=to_jsonb(u)->'raw_app_meta_data'->>'saleschild_provisioning_id'
    where u.id=(select auth.uid()) and (select auth.uid()) is not null
      and (p.user_id is null or p.user_id=u.id));
$$;
create function public.member_preparation_status() returns boolean
language sql security invoker set search_path = '' as $$ select private.member_preparation_status(); $$;
revoke all on function private.member_preparation_status(),public.member_preparation_status() from public,anon;
grant execute on function private.member_preparation_status(),public.member_preparation_status() to authenticated;

create function private.prevent_member_owner_bootstrap() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.created_by=(select auth.uid()) and private.member_preparation_status() then
    raise exception 'Member account preparation must finish before workspace access' using errcode='42501';
  end if;
  return new;
end; $$;
revoke all on function private.prevent_member_owner_bootstrap() from public,anon,authenticated;
create trigger member_bootstrap_guard before insert on public.organizations for each row execute function private.prevent_member_owner_bootstrap();

-- Contains only a fingerprint of Auth's existing password hash, never a password
-- or recoverable temporary passcode. It is not exposed by the Data API.
create table private.member_credentials (
  provisioning_id uuid primary key references public.member_provisioning(id),
  password_fingerprint text not null,
  version integer not null default 1 check(version > 0)
);
create table private.member_operation_limits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  actor_id uuid not null references auth.users(id),
  kind text not null check(kind in('provision','reset','remove')),
  created_at timestamptz not null default now()
);
create index member_operation_window on private.member_operation_limits(organization_id,created_at);
alter table private.member_credentials enable row level security;
alter table private.member_operation_limits enable row level security;
revoke all on private.member_credentials,private.member_operation_limits from public,anon,authenticated;

create function private.require_member_owner(org_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or coalesce(private.membership_role(org_id),'')<>'owner'
    or not exists(select 1 from auth.users u where u.id=(select auth.uid()) and u.email_confirmed_at is not null)
  then raise exception 'Verified owner access required' using errcode='42501'; end if;
  perform 1 from public.organizations where id=org_id for update;
end; $$;

create function private.consume_member_operation(org_id uuid, operation_kind text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from private.member_operation_limits where organization_id=org_id and created_at>now()-interval '1 hour')>=10
    or (select count(*) from private.member_operation_limits where organization_id=org_id and created_at>now()-interval '1 day')>=30
  then raise exception 'Member management rate limit reached' using errcode='P0001'; end if;
  insert into private.member_operation_limits(organization_id,actor_id,kind) values(org_id,auth.uid(),operation_kind);
end; $$;

create function private.member_seats_used(org_id uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select ((select count(*) from public.memberships m where m.organization_id=org_id and m.role='learner' and m.lifecycle<>'revoked') +
    (select count(*) from public.member_provisioning p where p.organization_id=org_id and p.state not in('revoked','failed')
      and not exists(select 1 from public.memberships m where m.organization_id=org_id and m.user_id=p.user_id and m.role='learner' and m.lifecycle<>'revoked')))::integer;
$$;

create function private.reserve_member(org_id uuid, operation_id uuid, member_email text, member_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare existing public.member_provisioning;
begin
  perform private.require_member_owner(org_id);
  select * into existing from public.member_provisioning where id=operation_id;
  if found then
    if existing.organization_id<>org_id or existing.email<>lower(btrim(member_email)) or existing.display_name<>btrim(member_name) then
      raise exception 'Provisioning request changed' using errcode='22023';
    end if;
    return jsonb_build_object('created',false,'state',existing.state);
  end if;
  if private.member_seats_used(org_id)>=2 then raise exception 'Both member seats are occupied' using errcode='P0001'; end if;
  if exists(select 1 from public.memberships m join auth.users u on u.id=m.user_id where m.organization_id=org_id and m.lifecycle<>'revoked' and lower(to_jsonb(u)->>'email')=lower(btrim(member_email))) then
    raise exception 'This identity already belongs to the workspace' using errcode='22023';
  end if;
  perform private.consume_member_operation(org_id,'provision');
  insert into public.member_provisioning(id,organization_id,email,display_name,created_by)
    values(operation_id,org_id,lower(btrim(member_email)),btrim(member_name),auth.uid());
  insert into public.audit_events(organization_id,actor_id,event_type,entity_type,entity_id) values(org_id,auth.uid(),'member_reserved','member',operation_id);
  return jsonb_build_object('created',true,'state','reserved');
end; $$;
create function public.reserve_member(org_id uuid, operation_id uuid, member_email text, member_name text) returns jsonb
language sql security invoker set search_path = '' as $$ select private.reserve_member(org_id,operation_id,member_email,member_name); $$;

-- The narrow Auth adapter writes a non-user-editable operation marker. A caller
-- cannot attach or reset an arbitrary existing identity using a supplied UUID.
create function private.attach_provisioned_member(org_id uuid, operation_id uuid, identity_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.member_provisioning; identity jsonb; fingerprint text;
begin
  perform private.require_member_owner(org_id);
  select * into p from public.member_provisioning where id=operation_id and organization_id=org_id for update;
  if not found or p.state not in('reserved','awaiting_verification','provisioned') then raise exception 'Provisioning request is unavailable'; end if;
  if p.user_id is not null and p.user_id<>identity_id then raise exception 'Provisioning identity is immutable' using errcode='42501'; end if;
  select to_jsonb(u) into identity from auth.users u where u.id=identity_id;
  if identity is null or identity->'raw_app_meta_data'->>'saleschild_provisioning_id' is distinct from operation_id::text
    or lower(identity->>'email') is distinct from p.email
    or exists(select 1 from public.memberships where user_id=identity_id and (organization_id<>org_id or role<>'learner'))
  then raise exception 'Provisioned identity could not be verified' using errcode='42501'; end if;
  fingerprint:=md5(coalesce(identity->>'encrypted_password',''));
  if coalesce(identity->>'encrypted_password','')='' then raise exception 'Password identity required'; end if;
  update public.member_provisioning set user_id=identity_id,state=case when identity->>'email_confirmed_at' is null then 'awaiting_verification' else 'provisioned' end,
    credential_expires_at=now()+interval '48 hours',updated_at=now() where id=operation_id;
  insert into public.memberships(organization_id,user_id,role,lifecycle,password_change_required,credential_version,credential_expires_at,setup_not_before)
    values(org_id,identity_id,'learner','provisioned',true,1,now()+interval '48 hours',floor(extract(epoch from clock_timestamp()))::bigint+1)
    on conflict(organization_id,user_id) do nothing;
  insert into private.member_credentials(provisioning_id,password_fingerprint) values(operation_id,fingerprint) on conflict(provisioning_id) do nothing;
  insert into public.profiles(user_id,display_name) values(identity_id,p.display_name) on conflict(user_id) do nothing;
end; $$;
create function public.attach_provisioned_member(org_id uuid, operation_id uuid, identity_id uuid) returns void
language sql security invoker set search_path = '' as $$ select private.attach_provisioned_member(org_id,operation_id,identity_id); $$;

create function private.fail_member_reservation(org_id uuid, operation_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_member_owner(org_id);
  if exists(select 1 from auth.users u where to_jsonb(u)->'raw_app_meta_data'->>'saleschild_provisioning_id'=operation_id::text) then
    raise exception 'Created identity requires reconciliation; the seat remains reserved' using errcode='42501';
  end if;
  update public.member_provisioning set state='failed',updated_at=now() where id=operation_id and organization_id=org_id and user_id is null and state='reserved';
end; $$;
create function public.fail_member_reservation(org_id uuid, operation_id uuid) returns void
language sql security invoker set search_path = '' as $$ select private.fail_member_reservation(org_id,operation_id); $$;

create function private.remove_workspace_member(org_id uuid, member_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare changed uuid;
begin
  perform private.require_member_owner(org_id);
  perform private.consume_member_operation(org_id,'remove');
  update public.memberships set lifecycle='revoked',revoked_at=now(),credential_version=credential_version+1
    where organization_id=org_id and user_id=member_id and role='learner' and lifecycle<>'revoked' returning user_id into changed;
  if changed is null then raise exception 'An active member was not found'; end if;
  update public.member_provisioning set state='revoked',updated_at=now() where organization_id=org_id and user_id=member_id;
  insert into public.audit_events(organization_id,actor_id,event_type,entity_type,entity_id) values(org_id,auth.uid(),'member_revoked','member',member_id);
end; $$;
create function public.remove_workspace_member(org_id uuid, member_id uuid) returns void
language sql security invoker set search_path = '' as $$ select private.remove_workspace_member(org_id,member_id); $$;

create function private.begin_member_reset(org_id uuid, member_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare provision_id uuid;
begin
  perform private.require_member_owner(org_id);
  select p.id into provision_id from public.member_provisioning p join auth.users u on u.id=p.user_id
    where p.organization_id=org_id and p.user_id=member_id and p.state in('active','provisioned','awaiting_verification')
    and to_jsonb(u)->'raw_app_meta_data'->>'saleschild_provisioning_id'=p.id::text;
  if provision_id is null then raise exception 'This identity cannot be reset through member provisioning' using errcode='42501'; end if;
  perform private.consume_member_operation(org_id,'reset');
  update private.member_credentials set password_fingerprint=(select md5(to_jsonb(u)->>'encrypted_password') from auth.users u where u.id=member_id)
    where provisioning_id=provision_id;
  update public.memberships set lifecycle='setup_required',password_change_required=true,credential_version=credential_version+1,
    credential_expires_at=now(),setup_not_before=floor(extract(epoch from clock_timestamp()))::bigint+1 where organization_id=org_id and user_id=member_id and role='learner' and lifecycle<>'revoked';
  if not found then raise exception 'This member cannot be reset'; end if;
  return provision_id;
end; $$;
create function public.begin_member_reset(org_id uuid, member_id uuid) returns uuid
language sql security invoker set search_path = '' as $$ select private.begin_member_reset(org_id,member_id); $$;

create function private.finalize_member_reset(org_id uuid, member_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.member_provisioning; fingerprint text;
begin
  perform private.require_member_owner(org_id);
  select * into p from public.member_provisioning where organization_id=org_id and user_id=member_id and state<>'revoked' for update;
  select md5(to_jsonb(u)->>'encrypted_password') into fingerprint from auth.users u where u.id=member_id
    and to_jsonb(u)->'raw_app_meta_data'->>'saleschild_provisioning_id'=p.id::text;
  if p.id is null or fingerprint is null or not exists(select 1 from private.member_credentials c where c.provisioning_id=p.id and c.password_fingerprint<>fingerprint) then
    raise exception 'Password reset is not confirmed' using errcode='42501';
  end if;
  update private.member_credentials set password_fingerprint=fingerprint,version=version+1 where provisioning_id=p.id;
  update public.memberships set lifecycle='setup_required',credential_expires_at=now()+interval '48 hours',setup_not_before=floor(extract(epoch from clock_timestamp()))::bigint+1
    where organization_id=org_id and user_id=member_id and lifecycle='setup_required' and password_change_required;
  if not found then raise exception 'Password reset is not pending'; end if;
  update public.member_provisioning set state='provisioned',credential_expires_at=now()+interval '48 hours',updated_at=now() where id=p.id;
end; $$;
create function public.finalize_member_reset(org_id uuid, member_id uuid) returns void
language sql security invoker set search_path = '' as $$ select private.finalize_member_reset(org_id,member_id); $$;

create function private.complete_member_setup(org_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); p public.member_provisioning; identity jsonb; m public.memberships;
begin
  if caller is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into m from public.memberships where organization_id=org_id and user_id=caller for update;
  select * into p from public.member_provisioning where organization_id=org_id and user_id=caller and state='provisioned';
  select to_jsonb(u) into identity from auth.users u where u.id=caller and email_confirmed_at is not null;
  if m.user_id is null or m.lifecycle not in('provisioned','setup_required') or not m.password_change_required
    or m.credential_expires_at is null or m.credential_expires_at<=now() or p.id is null or identity is null
    or coalesce(identity->>'encrypted_password','')=''
    or m.setup_not_before>coalesce((nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'iat')::bigint,0)
    or not private.member_session_is_current(m.setup_not_before)
    or identity->'raw_app_meta_data'->>'saleschild_provisioning_id' is distinct from p.id::text
    or not exists(select 1 from private.member_credentials c where c.provisioning_id=p.id and c.password_fingerprint<>md5(coalesce(identity->>'encrypted_password','')))
  then raise exception 'Verified password setup is required' using errcode='42501'; end if;
  update public.memberships set lifecycle='active',password_change_required=false,credential_expires_at=null,
    access_not_before=floor(extract(epoch from clock_timestamp()))::bigint+1,
    first_login_at=coalesce(first_login_at,now()),last_seen_at=now() where organization_id=org_id and user_id=caller;
  update public.member_provisioning set state='active',updated_at=now() where id=p.id;
  insert into public.audit_events(organization_id,actor_id,event_type,entity_type,entity_id) values(org_id,caller,'member_activated','member',caller);
end; $$;
create function public.complete_member_setup(org_id uuid) returns void
language sql security invoker set search_path = '' as $$ select private.complete_member_setup(org_id); $$;

create function private.record_workspace_presence(org_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or private.membership_role(org_id) is null then raise exception 'Workspace access required' using errcode='42501'; end if;
  update public.memberships set first_login_at=coalesce(first_login_at,now()),last_seen_at=now()
    where organization_id=org_id and user_id=(select auth.uid()) and (last_seen_at is null or last_seen_at<now()-interval '2 minutes');
end; $$;
create function public.record_workspace_presence(org_id uuid) returns void
language sql security invoker set search_path = '' as $$ select private.record_workspace_presence(org_id); $$;

create function private.list_workspace_members(org_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  perform private.require_member_owner(org_id);
  select coalesce(jsonb_agg(row_data order by row_data->>'name'),'[]'::jsonb) into result from (
    select jsonb_build_object('id',coalesce(p.id,m.user_id),'userId',m.user_id,
      'name',coalesce(pr.display_name,p.display_name,'Member'),'email',coalesce(p.email,to_jsonb(u)->>'email',''),
      'role',m.role,'status',case when m.lifecycle='active' then 'active' when m.lifecycle='revoked' then 'revoked' else 'provisioned' end,
      'firstLoginAt',m.first_login_at,'lastSeenAt',m.last_seen_at) row_data
    from public.memberships m join auth.users u on u.id=m.user_id
    left join public.profiles pr on pr.user_id=m.user_id
    left join public.member_provisioning p on p.organization_id=m.organization_id and p.user_id=m.user_id and p.state not in('failed','revoked')
    where m.organization_id=org_id
    union all
    select jsonb_build_object('id',p.id,'userId',null,'name',p.display_name,'email',p.email,'role','learner','status',p.state,'firstLoginAt',null,'lastSeenAt',null)
    from public.member_provisioning p where p.organization_id=org_id and p.user_id is null and p.state not in('revoked','failed')
  ) members;
  return jsonb_build_object('members',result,'seats',jsonb_build_object('used',private.member_seats_used(org_id),'limit',2));
end; $$;
create function public.list_workspace_members(org_id uuid) returns jsonb
language sql security invoker set search_path = '' as $$ select private.list_workspace_members(org_id); $$;

-- Internal-only helpers cannot be invoked directly; wrapper targets are explicit.
revoke all on function private.require_member_owner(uuid),private.consume_member_operation(uuid,text),private.member_seats_used(uuid) from public,anon,authenticated;
revoke all on function private.reserve_member(uuid,uuid,text,text),private.attach_provisioned_member(uuid,uuid,uuid),private.fail_member_reservation(uuid,uuid),private.remove_workspace_member(uuid,uuid),private.begin_member_reset(uuid,uuid),private.finalize_member_reset(uuid,uuid),private.complete_member_setup(uuid),private.record_workspace_presence(uuid),private.list_workspace_members(uuid) from public,anon;
grant execute on function private.reserve_member(uuid,uuid,text,text),private.attach_provisioned_member(uuid,uuid,uuid),private.fail_member_reservation(uuid,uuid),private.remove_workspace_member(uuid,uuid),private.begin_member_reset(uuid,uuid),private.finalize_member_reset(uuid,uuid),private.complete_member_setup(uuid),private.record_workspace_presence(uuid),private.list_workspace_members(uuid) to authenticated;
revoke all on function public.reserve_member(uuid,uuid,text,text),public.attach_provisioned_member(uuid,uuid,uuid),public.fail_member_reservation(uuid,uuid),public.remove_workspace_member(uuid,uuid),public.begin_member_reset(uuid,uuid),public.finalize_member_reset(uuid,uuid),public.complete_member_setup(uuid),public.record_workspace_presence(uuid),public.list_workspace_members(uuid) from public,anon;
grant execute on function public.reserve_member(uuid,uuid,text,text),public.attach_provisioned_member(uuid,uuid,uuid),public.fail_member_reservation(uuid,uuid),public.remove_workspace_member(uuid,uuid),public.begin_member_reset(uuid,uuid),public.finalize_member_reset(uuid,uuid),public.complete_member_setup(uuid),public.record_workspace_presence(uuid),public.list_workspace_members(uuid) to authenticated;

commit;
