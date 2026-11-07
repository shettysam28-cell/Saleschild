-- Development-only supporting DDL. Never auto-apply from production migrations.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table private.edge_member_reset_requests (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id),
  member_id uuid not null references auth.users(id),
  provisioning_id uuid not null references public.member_provisioning(id),
  claimed_at timestamptz not null default now(),
  finished_at timestamptz
);
create unique index edge_member_reset_inflight on private.edge_member_reset_requests(organization_id,member_id) where finished_at is null;
alter table private.edge_member_reset_requests enable row level security;
revoke all on private.edge_member_reset_requests from public,anon,authenticated;

create function private.begin_edge_member_reset(org_id uuid,member_id uuid,operation_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare prior private.edge_member_reset_requests; provision_id uuid;
begin
  perform private.require_member_owner(org_id);
  if operation_id is null then raise exception 'Reset operation required' using errcode='22023'; end if;
  select * into prior from private.edge_member_reset_requests where id=operation_id;
  if found then
    if prior.organization_id<>org_id or prior.member_id<>member_id then
      raise exception 'Reset request changed' using errcode='22023';
    end if;
    -- A response lost in transit never exposes or regenerates a previous password.
    return null;
  end if;
  if exists(select 1 from private.edge_member_reset_requests r where r.organization_id=org_id and r.member_id=begin_edge_member_reset.member_id and r.finished_at is null) then
    raise exception 'An earlier reset needs reconciliation' using errcode='42501';
  end if;
  provision_id:=private.begin_member_reset(org_id,member_id);
  insert into private.edge_member_reset_requests(id,organization_id,member_id,provisioning_id) values(operation_id,org_id,member_id,provision_id);
  return provision_id;
end; $$;
create function public.begin_edge_member_reset(org_id uuid,member_id uuid,operation_id uuid) returns uuid
language sql security invoker set search_path='' as $$ select private.begin_edge_member_reset(org_id,member_id,operation_id); $$;

create function private.finalize_edge_member_reset(org_id uuid,member_id uuid,operation_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_member_owner(org_id);
  if not exists(select 1 from private.edge_member_reset_requests r where r.id=operation_id and r.organization_id=org_id and r.member_id=finalize_edge_member_reset.member_id and r.finished_at is null and r.claimed_at>now()-interval '5 minutes') then
    raise exception 'Reset claim is missing, expired or completed' using errcode='42501';
  end if;
  perform private.finalize_member_reset(org_id,member_id);
  update private.edge_member_reset_requests set finished_at=now() where id=operation_id;
end; $$;
create function public.finalize_edge_member_reset(org_id uuid,member_id uuid,operation_id uuid) returns void
language sql security invoker set search_path='' as $$ select private.finalize_edge_member_reset(org_id,member_id,operation_id); $$;

revoke all on function private.begin_edge_member_reset(uuid,uuid,uuid),private.finalize_edge_member_reset(uuid,uuid,uuid),public.begin_edge_member_reset(uuid,uuid,uuid),public.finalize_edge_member_reset(uuid,uuid,uuid) from public,anon;
grant execute on function private.begin_edge_member_reset(uuid,uuid,uuid),private.finalize_edge_member_reset(uuid,uuid,uuid),public.begin_edge_member_reset(uuid,uuid,uuid),public.finalize_edge_member_reset(uuid,uuid,uuid) to authenticated;
commit;
