-- Grouped draft lifecycle. Review and approve before production application.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
alter table public.knowledge_items add column discarded_at timestamptz;
alter table public.knowledge_source_records add column discarded_at timestamptz;
-- The legacy table had a table-wide INSERT grant. Replace it with source-field
-- grants so adding the lifecycle column does not let clients forge archives.
revoke insert on public.knowledge_source_records from authenticated;
grant insert(organization_id,batch_id,knowledge_id,source_row,fields) on public.knowledge_source_records to authenticated;
create index knowledge_active_org_idx on public.knowledge_items(organization_id,created_at desc) where discarded_at is null;
drop index public.knowledge_gateway_exact_unique;
create unique index knowledge_gateway_exact_unique on public.knowledge_items(organization_id,gateway_fingerprint) where gateway_fingerprint is not null and discarded_at is null;
drop index public.knowledge_sources_exact_unique;
create unique index knowledge_sources_exact_unique on public.knowledge_source_records(organization_id,content_fingerprint) where discarded_at is null;

-- Archived drafts remain readable to authors for provenance, but cannot be edited,
-- published, or silently restored through existing generic update endpoints.
create function private.guard_discarded_knowledge() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if old.discarded_at is not null then raise exception 'Discarded drafts are immutable' using errcode='55000'; end if;
 return new;
end; $$;
revoke all on function private.guard_discarded_knowledge() from public,anon,authenticated;
create trigger knowledge_discard_guard before update on public.knowledge_items for each row execute function private.guard_discarded_knowledge();

create function public.list_knowledge_draft_groups(org_id uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
 if (select auth.uid()) is null or coalesce(private.membership_role(org_id),'') not in('owner','admin','editor') then raise exception 'Author access required' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(g.payload order by g.created_at desc,g.id) from (
  select u.id,u.created_at,jsonb_build_object('id',u.id,'kind','review','sourceName',u.source_name,'createdAt',u.created_at,'recordCount',0,'draftCount',0,'publishedCount',0,'discardedCount',0,'resumable',true,'records','[]'::jsonb) payload
  from public.gateway_uploads u where u.organization_id=org_id and u.created_by=(select auth.uid()) and u.saved_ids is null and u.expires_at>now()
  union all
  select s.upload_id,min(s.created_at),jsonb_build_object('id',s.upload_id,'kind','gateway','sourceName',coalesce(min(s.origin->>'fileName'),'Uploaded source'),'createdAt',min(s.created_at),'recordCount',count(*),'draftCount',count(*)filter(where k.status='draft' and k.discarded_at is null),'publishedCount',count(*)filter(where k.status='published'),'discardedCount',count(*)filter(where k.discarded_at is not null),'resumable',false,'records',jsonb_agg(jsonb_build_object('id',k.id,'title',k.title,'status',k.status,'version',k.current_version,'discarded',k.discarded_at is not null) order by k.created_at,k.id))
  from public.gateway_sources s join public.knowledge_items k on k.organization_id=s.organization_id and k.id=s.knowledge_id where s.organization_id=org_id group by s.upload_id
  union all
  select b.id,b.created_at,jsonb_build_object('id',b.id,'kind','legacy','sourceName',b.source_name,'createdAt',b.created_at,'recordCount',count(*),'draftCount',count(*)filter(where k.status='draft' and k.discarded_at is null),'publishedCount',count(*)filter(where k.status='published'),'discardedCount',count(*)filter(where k.discarded_at is not null),'resumable',false,'records',jsonb_agg(jsonb_build_object('id',k.id,'title',k.title,'status',k.status,'version',k.current_version,'discarded',k.discarded_at is not null) order by s.source_row,k.id))
  from public.knowledge_import_batches b join public.knowledge_source_records s on s.organization_id=b.organization_id and s.batch_id=b.id join public.knowledge_items k on k.organization_id=s.organization_id and k.id=s.knowledge_id where b.organization_id=org_id group by b.id,b.source_name,b.created_at
  order by 2 desc,1 limit 50
 )g),'[]'::jsonb);
end; $$;

-- A narrow definer is necessary: customers have no UPDATE grant on lifecycle
-- columns or legacy immutable source snapshots. It checks trusted membership,
-- locks the tenant plus records, checks every version/dependency, and changes
-- lifecycle only. It never exposes raw uploads belonging to another author.
create function private.discard_knowledge_draft_group(org_id uuid,group_id uuid,group_kind text,expected_records jsonb) returns integer language plpgsql security definer set search_path='' as $$
declare ids uuid[]; current_records jsonb; changed integer; active_count integer;
begin
 if (select auth.uid()) is null or coalesce(private.membership_role(org_id),'') not in('owner','admin','editor') then raise exception 'Author access required' using errcode='42501'; end if;
 if group_id is null or group_kind is null or group_kind not in('gateway','legacy','review') or expected_records is null or jsonb_typeof(expected_records)<>'array' or jsonb_array_length(expected_records)>200 or octet_length(expected_records::text)>20000 then raise exception 'Invalid group confirmation' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(org_id::text,0));
 if group_kind='review' then
  if jsonb_array_length(expected_records)<>0 then raise exception 'Invalid review confirmation' using errcode='22023'; end if;
  delete from public.gateway_uploads u where u.id=group_id and u.organization_id=org_id and u.created_by=(select auth.uid()) and u.saved_ids is null;
  get diagnostics changed=row_count;
  if changed=0 then raise exception 'Review is no longer available' using errcode='40001'; end if;
  insert into public.audit_events(organization_id,actor_id,event_type,entity_type,entity_id) values(org_id,(select auth.uid()),'discarded','gateway_review',group_id);
  return changed;
 end if;
 if group_kind='gateway' then
  select array_agg(s.knowledge_id order by s.knowledge_id) into ids from public.gateway_sources s where s.organization_id=org_id and s.upload_id=group_id;
 else
  select array_agg(s.knowledge_id order by s.knowledge_id) into ids from public.knowledge_source_records s where s.organization_id=org_id and s.batch_id=group_id;
 end if;
 if coalesce(cardinality(ids),0)=0 then raise exception 'Group not available' using errcode='42501'; end if;
 perform k.id from public.knowledge_items k where k.organization_id=org_id and k.id=any(ids) order by k.id for update;
 select count(*) into active_count from public.knowledge_items k where k.organization_id=org_id and k.id=any(ids) and k.discarded_at is null;
 if active_count=0 then return 0; end if;
 if exists(select 1 from public.knowledge_items k where k.organization_id=org_id and k.id=any(ids) and(k.status='published' or exists(select 1 from public.knowledge_versions v where v.organization_id=org_id and v.knowledge_id=k.id and v.status='published') or exists(select 1 from public.lessons l where l.organization_id=org_id and l.source_knowledge_id=k.id) or exists(select 1 from public.learning_revision_units u where u.organization_id=org_id and u.source_knowledge_id=k.id))) then raise exception 'Approved or dependent knowledge cannot be discarded' using errcode='55000'; end if;
 select jsonb_agg(jsonb_build_object('id',k.id,'version',k.current_version)order by k.id) into current_records from public.knowledge_items k where k.organization_id=org_id and k.id=any(ids) and k.discarded_at is null;
 if current_records is distinct from(select jsonb_agg(value order by value->>'id')from jsonb_array_elements(expected_records)) then raise exception 'Draft versions changed' using errcode='40001'; end if;
 update public.knowledge_items k set discarded_at=now() where k.organization_id=org_id and k.id=any(ids) and k.discarded_at is null;
 get diagnostics changed=row_count;
 update public.knowledge_source_records s set discarded_at=now() where s.organization_id=org_id and s.knowledge_id=any(ids) and s.discarded_at is null;
 insert into public.audit_events(organization_id,actor_id,event_type,entity_type,entity_id) values(org_id,(select auth.uid()),'discarded','knowledge_draft_group',group_id);
 return changed;
end; $$;
revoke all on function private.discard_knowledge_draft_group(uuid,uuid,text,jsonb) from public,anon;
grant execute on function private.discard_knowledge_draft_group(uuid,uuid,text,jsonb) to authenticated;
create function public.discard_knowledge_draft_group(org_id uuid,group_id uuid,group_kind text,expected_records jsonb) returns integer language sql security invoker set search_path='' as $$select private.discard_knowledge_draft_group(org_id,group_id,group_kind,expected_records);$$;
revoke all on function public.list_knowledge_draft_groups(uuid),public.discard_knowledge_draft_group(uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.list_knowledge_draft_groups(uuid),public.discard_knowledge_draft_group(uuid,uuid,text,jsonb) to authenticated;
create or replace function public.check_gateway_duplicates(org_id uuid,candidates jsonb) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if (select auth.uid()) is null or coalesce(private.membership_role(org_id),'') not in('owner','admin','editor') then raise exception 'Author access required' using errcode='42501'; end if;
 if jsonb_typeof(candidates)<>'array' or jsonb_array_length(candidates)>250 or octet_length(candidates::text)>3000000 then raise exception 'Invalid duplicate request'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('key',c->>'key','exact',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'title',m.title,'excerpt',left(m.body,1000))) from (select k.id,k.title,k.body from public.knowledge_items k where k.organization_id=org_id and k.discarded_at is null and (k.gateway_fingerprint=private.gateway_fingerprint(c->'fields') or exists(select 1 from public.knowledge_source_records s where s.organization_id=org_id and s.discarded_at is null and s.knowledge_id=k.id and s.gateway_fingerprint=private.gateway_fingerprint(c->'fields'))) order by k.id limit 3) m),'[]'::jsonb),'possible',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'title',m.title,'excerpt',left(m.body,1000))) from (select k.id,k.title,k.body from public.knowledge_items k where k.organization_id=org_id and k.discarded_at is null and lower(btrim(k.title))=lower(btrim(c->>'title')) and k.gateway_fingerprint is distinct from private.gateway_fingerprint(c->'fields') order by k.id limit 3) m),'[]'::jsonb))),'[]'::jsonb) into result from jsonb_array_elements(candidates) c;
 return result;
end; $$;

create or replace function public.commit_gateway_upload(org_id uuid,upload_id uuid,expected_revision integer,request_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare u public.gateway_uploads; r jsonb; fields jsonb; ids uuid[]:='{}'; item_id uuid; selected_count integer; sheet_no integer; source_row integer; header_row integer; original jsonb; origin jsonb; fingerprints text[]:='{}'; fingerprint text;
begin
 if (select auth.uid()) is null or coalesce(private.membership_role(org_id),'') not in('owner','admin','editor') then raise exception 'Author access required' using errcode='42501'; end if;
 if request_id is null then raise exception 'Request id required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(org_id::text,0));
 select * into u from public.gateway_uploads x where x.id=upload_id and x.organization_id=org_id and x.created_by=(select auth.uid());
 if not found then raise exception 'Upload not found' using errcode='42501'; end if;
 if u.saved_ids is not null then
  if u.saved_request=request_id and u.revision=expected_revision then return to_jsonb(u.saved_ids); end if;
  raise exception 'This upload was already saved. Reopen its saved resources.' using errcode='40001';
 end if;
 select * into u from public.gateway_uploads x where x.id=upload_id and x.organization_id=org_id and x.created_by=(select auth.uid()) for update;
 if not found then raise exception 'Review is no longer editable' using errcode='40001'; end if;
 if u.expires_at<=now() or u.revision<>expected_revision then raise exception 'Review changed or expired' using errcode='40001'; end if;
 select count(*) into selected_count from jsonb_array_elements(u.review_rows) x where not coalesce((x->>'excluded')::boolean,false);
 if selected_count<>(select count(distinct x->>'row') from jsonb_array_elements(u.review_rows) x where not coalesce((x->>'excluded')::boolean,false)) then raise exception 'Each source row may be saved once' using errcode='22023'; end if;
 if selected_count not between 1 and 200 then raise exception 'Choose 1–200 records' using errcode='22023'; end if;
 sheet_no:=(u.choices->>'sheet')::integer;header_row:=(u.choices->>'headerRow')::integer;
 if sheet_no<0 or sheet_no>=jsonb_array_length(u.extraction->'sheets') or header_row<0 or header_row>10000 then raise exception 'Invalid worksheet/header' using errcode='22023'; end if;
 for r in select value from jsonb_array_elements(u.review_rows) where not coalesce((value->>'excluded')::boolean,false) loop
  fields:=r->'fields'; source_row:=(r->>'row')::integer;
  if not private.valid_gateway_fields(fields) or jsonb_array_length(fields)=0 or char_length(btrim(r->>'title')) not between 3 and 160 or char_length(private.gateway_body(fields)) not between 20 and 20000 or source_row<=header_row or not exists(select 1 from jsonb_array_elements(u.extraction#>array['sheets',sheet_no::text,'rows']) x where (x->>'row')::integer=source_row) then raise exception 'Invalid reviewed record' using errcode='22023'; end if;
  fingerprint:=private.gateway_fingerprint(fields);
  if fingerprint=any(fingerprints) or exists(select 1 from public.knowledge_items k where k.organization_id=org_id and k.discarded_at is null and k.gateway_fingerprint=fingerprint) or exists(select 1 from public.knowledge_source_records s where s.organization_id=org_id and s.discarded_at is null and s.gateway_fingerprint=fingerprint) then raise exception 'Exact duplicate detected. Review and skip duplicates before saving.' using errcode='23505'; end if;
  if not coalesce((r->>'confirmed')::boolean,false) and exists(select 1 from public.knowledge_items k where k.organization_id=org_id and k.discarded_at is null and lower(btrim(k.title))=lower(btrim(r->>'title'))) then raise exception 'Inspect possible duplicates and confirm separate records.' using errcode='22023'; end if;
  fingerprints:=array_append(fingerprints,fingerprint);
 end loop;
 for r in select value from jsonb_array_elements(u.review_rows) where not coalesce((value->>'excluded')::boolean,false) loop
  fields:=r->'fields';source_row:=(r->>'row')::integer;
  insert into public.knowledge_items(organization_id,title,body,status,created_by,custom_fields) values(org_id,btrim(r->>'title'),private.gateway_body(fields),'draft',(select auth.uid()),fields) returning id into item_id;
  original:=private.gateway_original_fields(u.extraction,sheet_no,source_row,header_row,jsonb_array_length(fields));
  origin:=jsonb_build_object('fileName',u.source_name,'digest',u.source_digest,'format',u.format,'worksheet',u.extraction#>>array['sheets',sheet_no::text,'name'],'row',source_row,'headerRow',header_row);
  if u.format='docx' then origin:=origin||jsonb_build_object('documentBlocks',u.extraction#>array['origins',source_row::text]); end if;
  insert into public.gateway_sources(organization_id,knowledge_id,upload_id,origin,original_fields) values(org_id,item_id,u.id,origin,original);
  ids:=array_append(ids,item_id);
 end loop;
 update public.gateway_uploads set saved_ids=ids,saved_request=request_id where id=u.id and organization_id=org_id;
 return to_jsonb(ids);
end; $$;

create or replace function public.import_knowledge_records_v2(org_id uuid,request_id uuid,source_name text,records jsonb,source_context jsonb) returns integer
language plpgsql security invoker set search_path='' as $$
declare caller uuid := (select auth.uid()); batch uuid; previous public.knowledge_import_batches; item jsonb; new_id uuid; row_number integer:=1; digest text;
begin
  if caller is null or coalesce(private.membership_role(org_id),'') not in ('owner','admin','editor') then raise exception 'Author access required' using errcode='42501'; end if;
  if request_id is null or source_name is null or char_length(source_name) not between 1 and 120 or jsonb_typeof(records)<>'array' or jsonb_array_length(records) not between 1 and 200 or octet_length(records::text)>2500000 then raise exception 'Invalid import'; end if;
  if source_context is null or jsonb_typeof(source_context)<>'object' or not (source_context ?& array['worksheet','rows']) or jsonb_typeof(source_context->'worksheet')<>'string' or char_length(source_context->>'worksheet') not between 1 and 100 or jsonb_typeof(source_context->'rows')<>'array' or jsonb_array_length(source_context->'rows')<>jsonb_array_length(records) or exists(select 1 from jsonb_array_elements(source_context->'rows') r where jsonb_typeof(r)<>'number' or r::text !~ '^[0-9]{1,5}$' or (r::text)::int not between 1 and 10000) then raise exception 'Invalid source context' using errcode='22023'; end if;
  -- Serialize imports within an organization. A concurrent import cannot slip past validation.
  perform pg_advisory_xact_lock(hashtextextended(org_id::text,0));
  digest := encode(sha256(convert_to(records::text,'UTF8')),'hex');
  select * into previous from public.knowledge_import_batches b where b.organization_id=org_id and b.created_by=caller and b.request_id=import_knowledge_records_v2.request_id;
  if found then
    if previous.request_digest<>digest or previous.source_name<>import_knowledge_records_v2.source_name or previous.source_context<>import_knowledge_records_v2.source_context then raise exception 'Request already used for a different source'; end if;
    return previous.record_count;
  end if;
  for item in select value from jsonb_array_elements(records) loop
    if not private.valid_source(item) then raise exception 'Invalid knowledge record'; end if;
  end loop;
  if (select count(distinct private.source_fingerprint(value)) from jsonb_array_elements(records))<>jsonb_array_length(records) or
    exists(select 1 from public.knowledge_source_records s where s.organization_id=org_id and s.discarded_at is null and s.content_fingerprint in (select private.source_fingerprint(value) from jsonb_array_elements(records))) then raise exception 'Duplicate or conflicting source; review before importing' using errcode='23505'; end if;
  insert into public.knowledge_import_batches(organization_id,request_id,source_name,record_count,request_digest,created_by,source_context)
    values(org_id,request_id,source_name,jsonb_array_length(records),digest,caller,source_context) returning id into batch;
  for item in select value from jsonb_array_elements(records) loop
    insert into public.knowledge_items(organization_id,title,body,source_url,status,created_by)
      values(org_id,btrim(item->>'Topic'),btrim(item->>'Knowledge Content'),
      case when item->>'Source Reference' ~ '^https://[^[:space:]]+$' and char_length(item->>'Source Reference')<=2048 then item->>'Source Reference' else null end,'draft',caller) returning id into new_id;
    row_number:=row_number+1;
    insert into public.knowledge_source_records(organization_id,batch_id,knowledge_id,source_row,fields)
      values(org_id,batch,new_id,row_number,item);
  end loop;
  return jsonb_array_length(records);
end;
$$;

create or replace function public.check_knowledge_import(org_id uuid, records jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
begin
  if (select auth.uid()) is null or coalesce(private.membership_role(org_id),'') not in ('owner','admin','editor') then raise exception 'Author access required' using errcode='42501'; end if;
  if jsonb_typeof(records)<>'array' or jsonb_array_length(records) not between 1 and 200 or octet_length(records::text)>2500000 then raise exception 'Invalid record count or size'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('fields',s.fields,'knowledge_id',s.knowledge_id))
    from public.knowledge_source_records s where s.organization_id=org_id and s.discarded_at is null and s.source_key in
    (select private.source_key(value) from jsonb_array_elements(records))), '[]'::jsonb);
end;
$$;
commit;
