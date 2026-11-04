begin;
-- Additive universal fields. Legacy fixed-template snapshots and RPCs remain intact.
create function private.valid_gateway_fields(fields jsonb) returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare f jsonb; ids text[] := '{}';
begin
 if fields is null or jsonb_typeof(fields)<>'array' or jsonb_array_length(fields)>32 or octet_length(fields::text)>500000 then return false; end if;
 for f in select value from jsonb_array_elements(fields) loop
  if jsonb_typeof(f)<>'object' or not(f ?& array['id','label','value']) or (select count(*) from jsonb_object_keys(f))<>3 or
   jsonb_typeof(f->'id')<>'string' or f->>'id' !~ '^c([1-9]|[12][0-9]|3[0-2])$' or f->>'id'=any(ids) or
   jsonb_typeof(f->'label')<>'string' or char_length(btrim(f->>'label')) not between 1 and 100 or
   jsonb_typeof(f->'value')<>'string' or char_length(f->>'value')>12000 or ((f->>'label')||(f->>'value')) ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]' then return false; end if;
  ids:=array_append(ids,f->>'id');
 end loop;
 return true;
end; $$;
create function private.gateway_body(fields jsonb) returns text language sql immutable security invoker set search_path='' as $$
 select coalesce(string_agg((f->>'label')||': '||(f->>'value'),E'\n\n' order by position),'') from jsonb_array_elements(fields) with ordinality a(f,position) where btrim(f->>'value')<>'';
$$;
create function private.gateway_fingerprint(fields jsonb) returns text language sql immutable security invoker set search_path='' as $$
 select encode(sha256(convert_to(coalesce((select jsonb_agg(jsonb_build_array(lower(btrim(normalize(f->>'label',NFC))),btrim(normalize(f->>'value',NFC))) order by lower(btrim(normalize(f->>'label',NFC))) collate "C",btrim(normalize(f->>'value',NFC)) collate "C") from jsonb_array_elements(fields) f),'[]'::jsonb)::text,'UTF8')),'hex');
$$;
create function private.gateway_legacy_fields(fields jsonb) returns jsonb language sql immutable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id','c'||position,'label',key,'value',value) order by position),'[]') from (select key,value,row_number()over(order by key) position from jsonb_each_text(fields)) x;
$$;
revoke all on function private.valid_gateway_fields(jsonb),private.gateway_body(jsonb),private.gateway_fingerprint(jsonb),private.gateway_legacy_fields(jsonb) from public,anon;
grant execute on function private.valid_gateway_fields(jsonb),private.gateway_body(jsonb),private.gateway_fingerprint(jsonb),private.gateway_legacy_fields(jsonb) to authenticated;
alter table public.knowledge_items add column custom_fields jsonb not null default '[]' check(private.valid_gateway_fields(custom_fields));
alter table public.knowledge_items add constraint gateway_body_consistent check(jsonb_array_length(custom_fields)=0 or body=private.gateway_body(custom_fields));
alter table public.knowledge_items add column gateway_fingerprint text generated always as(case when jsonb_array_length(custom_fields)>0 then private.gateway_fingerprint(custom_fields) end) stored;
create unique index knowledge_gateway_exact_unique on public.knowledge_items(organization_id,gateway_fingerprint) where gateway_fingerprint is not null;
alter table public.knowledge_versions add column custom_fields jsonb not null default '[]' check(private.valid_gateway_fields(custom_fields));
alter table public.knowledge_versions add constraint knowledge_versions_tenant_version unique(organization_id,knowledge_id,version);
alter table public.knowledge_source_records add column gateway_fingerprint text generated always as(private.gateway_fingerprint(private.gateway_legacy_fields(fields))) stored;
create index legacy_gateway_exact_idx on public.knowledge_source_records(organization_id,gateway_fingerprint);
create or replace function private.snapshot_knowledge() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.knowledge_versions(organization_id,knowledge_id,version,title,body,source_url,status,evidence_status,custom_fields)
 values(new.organization_id,new.id,new.current_version,new.title,new.body,new.source_url,new.status,new.evidence_status,new.custom_fields);
 return new;
end; $$;
-- Existing restricted private trigger alone writes immutable historical snapshots.
revoke all on function private.snapshot_knowledge() from public,anon,authenticated;
grant insert(custom_fields),update(custom_fields) on public.knowledge_items to authenticated;

create table public.gateway_uploads(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), created_by uuid not null references auth.users(id),
 source_name text not null check(char_length(source_name) between 1 and 120), source_digest text not null check(source_digest ~ '^[a-f0-9]{64}$'), format text not null check(format in('csv','xlsx','docx')),
 extraction jsonb not null check(jsonb_typeof(extraction)='object' and jsonb_typeof(extraction->'sheets')='array' and jsonb_array_length(extraction->'sheets') between 1 and 20 and octet_length(extraction::text)<=3000000),
 choices jsonb not null default '{}',review_rows jsonb not null default '[]',revision integer not null default 0 check(revision>=0),
 saved_ids uuid[],saved_request uuid, created_at timestamptz not null default now(),expires_at timestamptz not null default(now()+interval '24 hours'),
 unique(organization_id,id),check(expires_at<=created_at+interval '24 hours'),check(octet_length(choices::text)<=2500000 and octet_length(review_rows::text)<=4000000)
);
create index gateway_upload_creator_idx on public.gateway_uploads(created_by);
create index gateway_upload_owner_idx on public.gateway_uploads(organization_id,created_by,created_at desc);
create index gateway_upload_digest_idx on public.gateway_uploads(organization_id,created_by,source_digest);
create table public.gateway_sources(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),knowledge_id uuid not null,upload_id uuid not null,
 origin jsonb not null check(jsonb_typeof(origin)='object' and octet_length(origin::text)<=200000),original_fields jsonb not null check(jsonb_typeof(original_fields)='array' and jsonb_array_length(original_fields) between 1 and 32 and octet_length(original_fields::text)<=500000),
 created_at timestamptz not null default now(),unique(organization_id,knowledge_id),
 foreign key(organization_id,knowledge_id) references public.knowledge_items(organization_id,id),foreign key(organization_id,upload_id) references public.gateway_uploads(organization_id,id)
);
create index gateway_sources_upload_idx on public.gateway_sources(organization_id,upload_id);
alter table public.gateway_uploads enable row level security;
alter table public.gateway_sources enable row level security;
revoke all on public.gateway_uploads,public.gateway_sources from public,anon,authenticated;
grant select,insert on public.gateway_uploads,public.gateway_sources to authenticated;
grant update(choices,review_rows,revision,saved_ids,saved_request) on public.gateway_uploads to authenticated;
grant delete on public.gateway_uploads to authenticated;
create policy gateway_upload_read on public.gateway_uploads for select to authenticated using(created_by=(select auth.uid()) and (select private.membership_role(organization_id)) in('owner','admin','editor'));
create policy gateway_upload_insert on public.gateway_uploads for insert to authenticated with check(created_by=(select auth.uid()) and (select private.membership_role(organization_id)) in('owner','admin','editor') and revision=0 and saved_ids is null and saved_request is null);
create policy gateway_upload_update on public.gateway_uploads for update to authenticated using(created_by=(select auth.uid()) and saved_ids is null and (select private.membership_role(organization_id)) in('owner','admin','editor')) with check(created_by=(select auth.uid()) and (select private.membership_role(organization_id)) in('owner','admin','editor'));
create policy gateway_upload_delete on public.gateway_uploads for delete to authenticated using(created_by=(select auth.uid()) and saved_ids is null and (select private.membership_role(organization_id)) in('owner','admin','editor'));
create policy gateway_source_read on public.gateway_sources for select to authenticated using((select private.membership_role(organization_id)) in('owner','admin','editor'));
create policy gateway_source_insert on public.gateway_sources for insert to authenticated with check((select private.membership_role(organization_id)) in('owner','admin','editor') and exists(select 1 from public.gateway_uploads u where u.id=upload_id and u.organization_id=gateway_sources.organization_id and u.created_by=(select auth.uid())));
create trigger gateway_source_audit after insert on public.gateway_sources for each row execute function private.record_audit();

create function public.stage_gateway_upload(org_id uuid,source_name text,source_digest text,source_format text,extraction jsonb,choices jsonb) returns uuid language plpgsql security invoker set search_path='' as $$
declare caller uuid := (select auth.uid()); new_id uuid;
begin
 if caller is null or coalesce(private.membership_role(org_id),'') not in('owner','admin','editor') then raise exception 'Author access required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(org_id::text||caller::text||'upload',0));
 delete from public.gateway_uploads where organization_id=org_id and created_by=caller and expires_at<now() and saved_ids is null;
 if (select count(*) from public.gateway_uploads where organization_id=org_id and created_by=caller and saved_ids is null)>=5 then raise exception 'Resume an existing upload or wait for an unused review to expire (24 hours).' using errcode='54000'; end if;
 if (select count(*) from public.gateway_uploads where organization_id=org_id and created_by=caller and created_at>now()-interval '24 hours')>=50 then raise exception 'Daily upload limit reached' using errcode='54000'; end if;
 insert into public.gateway_uploads(organization_id,created_by,source_name,source_digest,format,extraction,choices) values(org_id,caller,source_name,source_digest,source_format,extraction,choices) returning id into new_id;
 return new_id;
end; $$;
create function public.check_gateway_duplicates(org_id uuid,candidates jsonb) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if (select auth.uid()) is null or coalesce(private.membership_role(org_id),'') not in('owner','admin','editor') then raise exception 'Author access required' using errcode='42501'; end if;
 if jsonb_typeof(candidates)<>'array' or jsonb_array_length(candidates)>250 or octet_length(candidates::text)>3000000 then raise exception 'Invalid duplicate request'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('key',c->>'key','exact',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'title',m.title,'excerpt',left(m.body,1000))) from (select k.id,k.title,k.body from public.knowledge_items k where k.organization_id=org_id and (k.gateway_fingerprint=private.gateway_fingerprint(c->'fields') or exists(select 1 from public.knowledge_source_records s where s.organization_id=org_id and s.knowledge_id=k.id and s.gateway_fingerprint=private.gateway_fingerprint(c->'fields'))) order by k.id limit 3) m),'[]'::jsonb),'possible',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'title',m.title,'excerpt',left(m.body,1000))) from (select k.id,k.title,k.body from public.knowledge_items k where k.organization_id=org_id and lower(btrim(k.title))=lower(btrim(c->>'title')) and k.gateway_fingerprint is distinct from private.gateway_fingerprint(c->'fields') order by k.id limit 3) m),'[]'::jsonb))),'[]'::jsonb) into result from jsonb_array_elements(candidates) c;
 return result;
end; $$;
create function public.save_gateway_review(org_id uuid,upload_id uuid,expected_revision integer,choices jsonb,rows jsonb) returns integer language plpgsql security invoker set search_path='' as $$
declare next_revision integer;
begin
 if (select auth.uid()) is null or coalesce(private.membership_role(org_id),'') not in('owner','admin','editor') then raise exception 'Author access required' using errcode='42501'; end if;
 if jsonb_typeof(rows)<>'array' or jsonb_array_length(rows)>250 or octet_length(rows::text)>4000000 then raise exception 'Invalid review'; end if;
 update public.gateway_uploads u set choices=save_gateway_review.choices,review_rows=rows,revision=u.revision+1 where u.id=upload_id and u.organization_id=org_id and u.created_by=(select auth.uid()) and u.revision=expected_revision and u.expires_at>now() and u.saved_ids is null returning u.revision into next_revision;
 if not found then raise exception 'Review changed, expired or was already saved. Reload it before continuing.' using errcode='40001'; end if;
 return next_revision;
end; $$;
create function private.gateway_original_fields(extraction jsonb,sheet_no integer,source_row integer,header_row integer,width integer) returns jsonb language sql immutable security invoker set search_path='' as $$
 select jsonb_agg(jsonb_build_object('id','c'||i,'label',coalesce(nullif(btrim(extraction#>>array['sheets',sheet_no::text,'rows',(select (position-1)::text from jsonb_array_elements(extraction#>array['sheets',sheet_no::text,'rows']) with ordinality r(value,position) where (value->>'row')::integer=header_row limit 1),'cells',(i-1)::text]),''),'Column '||i),'value',coalesce(normalize((select value#>>array['cells',(i-1)::text] from jsonb_array_elements(extraction#>array['sheets',sheet_no::text,'rows']) r(value) where (value->>'row')::integer=source_row limit 1),NFC),'')) order by i) from generate_series(1,width) i;
$$;
revoke all on function private.gateway_original_fields(jsonb,integer,integer,integer,integer) from public,anon;
grant execute on function private.gateway_original_fields(jsonb,integer,integer,integer,integer) to authenticated;
create function public.commit_gateway_upload(org_id uuid,upload_id uuid,expected_revision integer,request_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
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
  if fingerprint=any(fingerprints) or exists(select 1 from public.knowledge_items k where k.organization_id=org_id and k.gateway_fingerprint=fingerprint) or exists(select 1 from public.knowledge_source_records s where s.organization_id=org_id and s.gateway_fingerprint=fingerprint) then raise exception 'Exact duplicate detected. Review and skip duplicates before saving.' using errcode='23505'; end if;
  if not coalesce((r->>'confirmed')::boolean,false) and exists(select 1 from public.knowledge_items k where k.organization_id=org_id and lower(btrim(k.title))=lower(btrim(r->>'title'))) then raise exception 'Inspect possible duplicates and confirm separate records.' using errcode='22023'; end if;
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
create function public.update_gateway_knowledge(org_id uuid,knowledge_id uuid,expected_version integer,title text,fields jsonb) returns integer language plpgsql security invoker set search_path='' as $$
declare result integer;
begin
 if (select auth.uid()) is null or coalesce(private.membership_role(org_id),'') not in('owner','admin','editor') then raise exception 'Author access required' using errcode='42501'; end if;
 if not private.valid_gateway_fields(fields) or jsonb_array_length(fields)=0 then raise exception 'Invalid custom fields' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(org_id::text,0));
 update public.knowledge_items k set title=update_gateway_knowledge.title,body=private.gateway_body(fields),custom_fields=fields,status='draft' where k.organization_id=org_id and k.id=knowledge_id and k.current_version=expected_version and jsonb_array_length(k.custom_fields)>0 returning current_version into result;
 if not found then raise exception 'Record changed or is no longer editable. Reload before editing.' using errcode='40001'; end if;
 return result;
end; $$;

-- Existing learning paths receive immutable approved-source snapshots, not generated content.
create table public.learning_path_source_batches(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),course_id uuid not null,created_by uuid not null references auth.users(id),request_id uuid not null,source_ids uuid[] not null check(cardinality(source_ids) between 1 and 50),record_count integer not null check(record_count between 1 and 50),created_at timestamptz not null default now(),
 unique(organization_id,id),unique(organization_id,course_id,created_by,request_id),foreign key(organization_id,course_id) references public.courses(organization_id,id)
);
create index learning_source_batches_course_idx on public.learning_path_source_batches(organization_id,course_id);
create index learning_source_batches_creator_idx on public.learning_path_source_batches(created_by);
alter table public.learning_path_source_batches enable row level security;
revoke all on public.learning_path_source_batches from public,anon,authenticated;
grant select,insert on public.learning_path_source_batches to authenticated;
create policy learning_source_batch_read on public.learning_path_source_batches for select to authenticated using((select private.membership_role(organization_id)) in('owner','admin','editor'));
create policy learning_source_batch_insert on public.learning_path_source_batches for insert to authenticated with check(created_by=(select auth.uid()) and (select private.membership_role(organization_id)) in('owner','admin','editor'));
alter table public.lessons add column source_knowledge_id uuid,add column source_version integer,add column source_batch_id uuid;
alter table public.lessons add constraint lesson_source_version_fk foreign key(organization_id,source_knowledge_id,source_version) references public.knowledge_versions(organization_id,knowledge_id,version);
alter table public.lessons add constraint lesson_source_batch_fk foreign key(organization_id,source_batch_id) references public.learning_path_source_batches(organization_id,id);
alter table public.lessons add constraint lesson_source_pair check((source_knowledge_id is null)=(source_version is null) and (source_knowledge_id is null)=(source_batch_id is null));
create unique index lesson_source_unique on public.lessons(organization_id,course_id,source_knowledge_id,source_version) where source_knowledge_id is not null;
create index lesson_source_idx on public.lessons(organization_id,source_knowledge_id,source_version);
create index lesson_source_batch_idx on public.lessons(organization_id,source_batch_id);
grant insert(source_knowledge_id,source_version,source_batch_id) on public.lessons to authenticated;
create function private.guard_source_lesson() returns trigger language plpgsql security invoker set search_path='' as $$
declare snapshot public.knowledge_versions;
begin
 if tg_op='UPDATE' and old.source_knowledge_id is not null and (new.source_knowledge_id is distinct from old.source_knowledge_id or new.source_version is distinct from old.source_version or new.source_batch_id is distinct from old.source_batch_id or new.organization_id<>old.organization_id or new.course_id<>old.course_id) then raise exception 'Approved lesson source identity is immutable' using errcode='42501'; end if;
 if new.source_knowledge_id is not null then
  select * into snapshot from public.knowledge_versions v where v.organization_id=new.organization_id and v.knowledge_id=new.source_knowledge_id and v.version=new.source_version and v.status='published';
  if not found or new.title<>snapshot.title or new.body<>snapshot.body then raise exception 'Lessons must match an approved source version' using errcode='42501'; end if;
  if tg_op='INSERT' and (not exists(select 1 from public.knowledge_items k where k.organization_id=new.organization_id and k.id=new.source_knowledge_id and k.status='published' and k.current_version=new.source_version) or not exists(select 1 from public.learning_path_source_batches b where b.organization_id=new.organization_id and b.id=new.source_batch_id and b.course_id=new.course_id and b.created_by=(select auth.uid()) and new.source_knowledge_id=any(b.source_ids))) then raise exception 'Approved current source and authorized path batch required' using errcode='42501'; end if;
 end if;
 return new;
end; $$;
revoke all on function private.guard_source_lesson() from public,anon,authenticated;
create trigger source_lesson_guard before insert or update on public.lessons for each row execute function private.guard_source_lesson();
create function public.add_knowledge_to_learning_path(org_id uuid,course_id uuid,source_ids uuid[],request_id uuid) returns integer language plpgsql security invoker set search_path='' as $$
declare previous public.learning_path_source_batches; source_id uuid; k public.knowledge_items; batch uuid; next_position integer; target public.courses;
begin
 if (select auth.uid()) is null or coalesce(private.membership_role(org_id),'') not in('owner','admin','editor') then raise exception 'Author access required' using errcode='42501'; end if;
 if request_id is null or cardinality(source_ids) not between 1 and 50 or cardinality(source_ids)<>(select count(distinct x) from unnest(source_ids) x) or array_position(source_ids,null) is not null then raise exception 'Choose 1–50 different approved records' using errcode='22023'; end if;
 select * into target from public.courses c where c.id=course_id and c.organization_id=org_id for update;
 if not found then raise exception 'Learning path not found' using errcode='42501'; end if;
 if target.status<>'draft' then raise exception 'Add sources to a draft path; published paths require a separate review.' using errcode='22023'; end if;
 select * into previous from public.learning_path_source_batches b where b.organization_id=org_id and b.course_id=add_knowledge_to_learning_path.course_id and b.created_by=(select auth.uid()) and b.request_id=add_knowledge_to_learning_path.request_id;
 if found then
  if previous.source_ids<>source_ids then raise exception 'Request id already used for other sources' using errcode='40001'; end if;
  return previous.record_count;
 end if;
 if (select count(*) from public.lessons l where l.organization_id=org_id and l.course_id=add_knowledge_to_learning_path.course_id)+cardinality(source_ids)>500 then raise exception 'A path supports at most 500 lessons' using errcode='54000'; end if;
 insert into public.learning_path_source_batches(organization_id,course_id,created_by,request_id,source_ids,record_count) values(org_id,course_id,(select auth.uid()),request_id,source_ids,cardinality(source_ids)) returning id into batch;
 select coalesce(max(l.position)+1,0) into next_position from public.lessons l where l.organization_id=org_id and l.course_id=add_knowledge_to_learning_path.course_id;
 foreach source_id in array source_ids loop
  select * into k from public.knowledge_items x where x.id=source_id and x.organization_id=org_id and x.status='published' for share;
  if not found then raise exception 'Every source must be approved and belong to this organization.' using errcode='42501'; end if;
  insert into public.lessons(organization_id,course_id,title,body,position,source_knowledge_id,source_version,source_batch_id) values(org_id,course_id,k.title,k.body,next_position,k.id,k.current_version,batch);
  next_position:=next_position+1;
 end loop;
 return cardinality(source_ids);
end; $$;
create trigger learning_source_batch_audit after insert on public.learning_path_source_batches for each row execute function private.record_audit();
create trigger lesson_source_audit after insert on public.lessons for each row execute function private.record_audit();
revoke all on function public.stage_gateway_upload(uuid,text,text,text,jsonb,jsonb),public.check_gateway_duplicates(uuid,jsonb),public.save_gateway_review(uuid,uuid,integer,jsonb,jsonb),public.commit_gateway_upload(uuid,uuid,integer,uuid),public.update_gateway_knowledge(uuid,uuid,integer,text,jsonb),public.add_knowledge_to_learning_path(uuid,uuid,uuid[],uuid) from public,anon;
grant execute on function public.stage_gateway_upload(uuid,text,text,text,jsonb,jsonb),public.check_gateway_duplicates(uuid,jsonb),public.save_gateway_review(uuid,uuid,integer,jsonb,jsonb),public.commit_gateway_upload(uuid,uuid,integer,uuid),public.update_gateway_knowledge(uuid,uuid,integer,text,jsonb),public.add_knowledge_to_learning_path(uuid,uuid,uuid[],uuid) to authenticated;
create function public.read_learning_path(org_id uuid,course_id uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare target public.courses;
begin
 if (select auth.uid()) is null or private.membership_role(org_id) is null then raise exception 'Organization access required' using errcode='42501'; end if;
 select * into target from public.courses c where c.id=course_id and c.organization_id=org_id;
 if not found then return null; end if;
 return jsonb_build_object('course',jsonb_build_object('id',target.id,'title',target.title,'description',target.description,'status',target.status),'lessons',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'title',l.title,'body',l.body,'position',l.position,'source_knowledge_id',l.source_knowledge_id,'source_version',l.source_version,'source_fields',coalesce(v.custom_fields,'[]'::jsonb)) order by l.position) from public.lessons l left join public.knowledge_versions v on v.organization_id=l.organization_id and v.knowledge_id=l.source_knowledge_id and v.version=l.source_version where l.organization_id=org_id and l.course_id=read_learning_path.course_id),'[]'::jsonb));
end; $$;
revoke all on function public.read_learning_path(uuid,uuid) from public,anon;
grant execute on function public.read_learning_path(uuid,uuid) to authenticated;
commit;
