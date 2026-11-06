-- PROPOSAL ONLY. Fresh, separate owner approval is required before hosted application.
-- No existing application, Auth, membership, source or progress row is rewritten.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create or replace function private.complete_member_setup(org_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); p public.member_provisioning; identity jsonb; m public.memberships;
begin
  if caller is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into m from public.memberships where organization_id=org_id and user_id=caller for update;
  select * into p from public.member_provisioning where organization_id=org_id and user_id=caller and state in('awaiting_verification','provisioned');
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
revoke all on function private.complete_member_setup(uuid) from public,anon;
grant execute on function private.complete_member_setup(uuid) to authenticated;

create function private.read_knowledge_field_labels(org_id uuid,knowledge_ids uuid[])
returns table(knowledge_id uuid,labels jsonb)
language plpgsql stable security definer set search_path='' as $$
declare role_name text:=private.membership_role(org_id); item record; template_headers jsonb;
 canonical text[]:=array['Topic','Category','Subtopic','Learning Objective','Knowledge Content','Process Steps','Example Scenario','Correct Response','Common Mistakes','Assessment Question','Answer Options','Correct Answer','Difficulty','Source Reference','Effective Date','Last Reviewed','Content Owner'];
begin
 if (select auth.uid()) is null or role_name is null then raise exception 'Organization access required' using errcode='42501'; end if;
 if knowledge_ids is null or cardinality(knowledge_ids)>200 then raise exception 'Choose at most 200 sources' using errcode='22023'; end if;
 for item in
  select g.knowledge_id,g.original_fields,g.origin,u.choices,u.extraction
  from public.gateway_sources g join public.gateway_uploads u on u.organization_id=g.organization_id and u.id=g.upload_id
  where g.organization_id=org_id and g.knowledge_id=any(knowledge_ids) and
   (role_name in('owner','admin','editor') or exists(select 1 from public.knowledge_versions v where v.organization_id=org_id and v.knowledge_id=g.knowledge_id and v.status='published'))
 loop
  template_headers:=null;
  -- Known-template fallback requires its entire exact header signature in the
  -- same source worksheet, at or before this record. Column count alone is not evidence.
  select h->'cells' into template_headers
  from jsonb_array_elements(item.extraction->'sheets') s
  cross join lateral jsonb_array_elements(s->'rows') h
  where s->>'name'=item.origin->>'worksheet'
   and jsonb_array_length(h->'cells')=cardinality(canonical)
   and (h->>'row')::integer<=case when item.origin->>'row' ~ '^[0-9]{1,5}$' then (item.origin->>'row')::integer else 0 end
   and (select jsonb_agg(lower(btrim(value #>> '{}')) order by n) from jsonb_array_elements(h->'cells') with ordinality a(value,n))
       =to_jsonb(array(select lower(x) from unnest(canonical) x))
  order by (h->>'row')::integer limit 1;
  return query select item.knowledge_id,coalesce(jsonb_object_agg(f->>'id',label) filter(where label is not null),'{}'::jsonb)
  from jsonb_array_elements(item.original_fields) with ordinality a(f,n)
  cross join lateral (select coalesce(
   case when btrim(coalesce(item.choices->'labels'->>((n-1)::integer),''))<>'' and item.choices->'labels'->>((n-1)::integer) !~* '^column\s*[0-9]+$' then item.choices->'labels'->>((n-1)::integer) end,
   case when btrim(coalesce(f->>'label',''))<>'' and f->>'label' !~* '^column\s*[0-9]+$' then f->>'label' end,
   case when template_headers is not null then canonical[n::integer] end
  ) as label) resolved;
 end loop;
end; $$;
revoke all on function private.read_knowledge_field_labels(uuid,uuid[]) from public,anon;
grant execute on function private.read_knowledge_field_labels(uuid,uuid[]) to authenticated;
create function public.read_knowledge_field_labels(org_id uuid,knowledge_ids uuid[])
returns table(knowledge_id uuid,labels jsonb)
language sql stable security invoker set search_path='' as $$ select * from private.read_knowledge_field_labels(org_id,knowledge_ids); $$;
revoke all on function public.read_knowledge_field_labels(uuid,uuid[]) from public,anon;
grant execute on function public.read_knowledge_field_labels(uuid,uuid[]) to authenticated;

commit;
