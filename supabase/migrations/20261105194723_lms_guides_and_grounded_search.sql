-- Additive study guides and approved-source retrieval. Preserve all source/history rows.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create table public.learning_revision_guides (
  organization_id uuid not null references public.organizations(id),
  revision_id uuid not null,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  primary key(revision_id,user_id),
  foreign key(organization_id,revision_id) references public.learning_path_revisions(organization_id,id),
  foreign key(organization_id,user_id) references public.memberships(organization_id,user_id)
);
create index learning_guides_user_org on public.learning_revision_guides(user_id,organization_id);
alter table public.learning_revision_guides enable row level security;
revoke all on public.learning_revision_guides from public,anon,authenticated;
grant select,insert(organization_id,revision_id,user_id) on public.learning_revision_guides to authenticated;
create policy guide_read on public.learning_revision_guides for select to authenticated
 using((select private.membership_role(organization_id)) is not null and user_id=(select auth.uid()));
create policy guide_insert on public.learning_revision_guides for insert to authenticated
 with check((select private.membership_role(organization_id)) is not null and user_id=(select auth.uid()));
create function public.save_learning_guide(org_id uuid,revision_id uuid) returns uuid
language plpgsql security invoker set search_path='' as $$
begin
 if (select auth.uid()) is null or private.membership_role(org_id) is null or not exists(select 1 from public.learning_path_revisions r where r.organization_id=org_id and r.id=revision_id) then raise exception 'Published learning access required' using errcode='42501'; end if;
 insert into public.learning_revision_guides(organization_id,revision_id,user_id)values(org_id,revision_id,(select auth.uid())) on conflict do nothing;
 return revision_id;
end; $$;
revoke all on function public.save_learning_guide(uuid,uuid) from public,anon;
grant execute on function public.save_learning_guide(uuid,uuid) to authenticated;

create index knowledge_approved_text_search on public.knowledge_items using gin(to_tsvector('english',title||' '||body)) where status='published' and discarded_at is null;
create or replace function public.search_approved_knowledge(org_id uuid,query_text text,result_limit integer default 5)
returns table(id uuid,title text,body text,current_version integer,custom_fields jsonb)
language plpgsql stable security invoker set search_path='' as $$
declare terms text[];
begin
 if (select auth.uid()) is null or private.membership_role(org_id) is null then raise exception 'Organization access required' using errcode='42501'; end if;
 if query_text is null or char_length(btrim(query_text)) not between 2 and 200 or result_limit is null or result_limit not between 1 and 10 then raise exception 'Search 2–200 characters, requesting at most ten sources' using errcode='22023'; end if;
 terms:=regexp_split_to_array(lower(btrim(query_text)),E'\\s+');
 if cardinality(terms)>12 then raise exception 'Use at most twelve concepts' using errcode='22023'; end if;
 return query select k.id,k.title,k.body,k.current_version,k.custom_fields from public.knowledge_items k
 where k.organization_id=org_id and k.status='published' and k.discarded_at is null and exists(
  select 1 from unnest(terms)t where strpos(lower(k.title||' '||k.body),t)>0 or (t ~ '^[[:alnum:]]+$' and to_tsvector('english',k.title||' '||k.body)@@plainto_tsquery('english',t))
 )
 order by (select sum(case when strpos(lower(k.title),t)>0 then 12 else 0 end + case when strpos(lower(k.body),t)>0 then 4 else 0 end + case when t ~ '^[[:alnum:]]+$' and to_tsvector('english',k.title||' '||k.body)@@plainto_tsquery('english',t) then 2 else 0 end + case when n=1 and strpos(lower(k.title||' '||k.body),t)>0 then 8 else 0 end) from unnest(terms) with ordinality q(t,n)) desc,k.title,k.id limit result_limit;
end; $$;

create function public.list_knowledge_draft_groups_v2(org_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare item jsonb; result jsonb:='[]'; reason text;
begin
 for item in select value from jsonb_array_elements(public.list_knowledge_draft_groups(org_id)) loop
  reason:=null;
  if (item->>'publishedCount')::integer>0 then reason:='This upload contains published knowledge. Its records and history are protected.';
  elsif (item->>'kind')<>'review' and exists(
    select 1 from jsonb_array_elements(item->'records')r where not (r->>'discarded')::boolean and (
      exists(select 1 from public.knowledge_versions v where v.organization_id=org_id and v.knowledge_id=(r->>'id')::uuid and v.status='published') or
      exists(select 1 from public.lessons l where l.organization_id=org_id and l.source_knowledge_id=(r->>'id')::uuid) or
      exists(select 1 from public.learning_revision_units u where u.organization_id=org_id and u.source_knowledge_id=(r->>'id')::uuid)
    )) then reason:='This upload contains previously published or learning-linked knowledge. Discard is unavailable to preserve its history.';
  end if;
  result:=result||jsonb_build_array(item||jsonb_build_object('discardable',reason is null and ((item->>'kind')='review' or (item->>'draftCount')::integer>0),'blockedReason',reason));
 end loop;
 return result;
end; $$;
revoke all on function public.list_knowledge_draft_groups_v2(uuid) from public,anon;
grant execute on function public.list_knowledge_draft_groups_v2(uuid) to authenticated;
create function public.list_individual_knowledge_drafts(org_id uuid) returns table(id uuid,title text,current_version integer)
language plpgsql stable security invoker set search_path='' as $$
begin
 if (select auth.uid()) is null or coalesce(private.membership_role(org_id),'') not in('owner','admin','editor') then raise exception 'Author access required' using errcode='42501'; end if;
 return query select k.id,k.title,k.current_version from public.knowledge_items k where k.organization_id=org_id and k.status='draft' and k.discarded_at is null and not exists(select 1 from public.gateway_sources s where s.organization_id=org_id and s.knowledge_id=k.id) and not exists(select 1 from public.knowledge_source_records s where s.organization_id=org_id and s.knowledge_id=k.id) order by k.created_at desc,k.id limit 50;
end; $$;
revoke all on function public.list_individual_knowledge_drafts(uuid) from public,anon;
grant execute on function public.list_individual_knowledge_drafts(uuid) to authenticated;
commit;
