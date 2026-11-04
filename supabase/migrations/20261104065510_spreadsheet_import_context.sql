begin;
alter table public.knowledge_import_batches add column source_context jsonb not null default '{}'::jsonb;
create or replace function private.valid_source(fields jsonb) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare expected text[] := array['Topic','Category','Subtopic','Learning Objective','Knowledge Content','Process Steps','Example Scenario','Correct Response','Common Mistakes','Assessment Question','Answer Options','Correct Answer','Difficulty','Source Reference','Effective Date','Last Reviewed','Content Owner']; item record; d text;
begin
  if jsonb_typeof(fields) <> 'object' or not (fields ?& expected) or
    (select count(*) from jsonb_object_keys(fields)) <> 17 then return false; end if;
  for item in select key,value from jsonb_each(fields) loop
    if jsonb_typeof(item.value)<>'string' or char_length(fields->>item.key)>12000 or
      (fields->>item.key ~ '^[[:space:]]*[=+@-]' and fields->>item.key !~ '^[[:space:]]*[+-]?[$€£¥]?[0-9][0-9,]*(\.[0-9]+)?%?[[:space:]]*$' and (fields->>item.key !~ '^[[:space:]]*-[[:space:]]+[[:alpha:]]' or fields->>item.key ~ '^[[:space:]]*-[[:space:]]*[A-Za-z._]+[[:space:]]*\(')) or fields->>item.key ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]' then return false; end if;
  end loop;
  if char_length(btrim(fields->>'Topic')) not between 3 and 160 or
    char_length(btrim(fields->>'Category')) not between 1 and 160 or
    char_length(fields->>'Subtopic')>160 or
    char_length(btrim(fields->>'Knowledge Content')) not between 20 and 12000 or
    fields->>'Difficulty' not in ('','Beginner','Intermediate','Advanced') then return false; end if;
  foreach d in array array[fields->>'Effective Date',fields->>'Last Reviewed'] loop
    if d<>'' and (d !~ '^\d{4}-\d{2}-\d{2}$' or to_char(d::date,'YYYY-MM-DD')<>d) then return false; end if;
  end loop;
  return true;
exception when others then return false;
end;
$$;
create function private.source_fingerprint(fields jsonb) returns text language sql immutable security invoker set search_path='' as $$
 select encode(sha256(convert_to((select jsonb_object_agg(key,case when key in ('Topic','Category','Subtopic') then lower(btrim(regexp_replace(normalize(value,NFC),'\s+',' ','g'))) else btrim(normalize(value,NFC)) end) from jsonb_each_text(fields))::text,'UTF8')),'hex');
$$;
revoke all on function private.source_fingerprint(jsonb) from public,anon;
grant execute on function private.source_fingerprint(jsonb) to authenticated;
alter table public.knowledge_source_records add column content_fingerprint text generated always as(private.source_fingerprint(fields)) stored;
-- Exact duplicates are disallowed; topic labels are grouping fields, not record identifiers.
create unique index knowledge_sources_exact_unique on public.knowledge_source_records(organization_id,content_fingerprint);
alter table public.knowledge_source_records drop constraint knowledge_source_records_organization_id_source_key_key;
create index knowledge_sources_topic_idx on public.knowledge_source_records(organization_id,source_key);
create function public.import_knowledge_records_v2(org_id uuid,request_id uuid,source_name text,records jsonb,source_context jsonb) returns integer
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
    exists(select 1 from public.knowledge_source_records s where s.organization_id=org_id and s.content_fingerprint in (select private.source_fingerprint(value) from jsonb_array_elements(records))) then raise exception 'Duplicate or conflicting source; review before importing' using errcode='23505'; end if;
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
revoke all on function public.import_knowledge_records_v2(uuid,uuid,text,jsonb,jsonb) from public,anon;
grant execute on function public.import_knowledge_records_v2(uuid,uuid,text,jsonb,jsonb) to authenticated;
commit;
