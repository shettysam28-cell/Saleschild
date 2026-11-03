begin;
-- Editors prepare drafts; only administrators approve publication.
alter policy knowledge_insert on public.knowledge_items with check (
  (select private.membership_role(organization_id)) in ('owner','admin','editor') and created_by=(select auth.uid()) and
  (status='draft' or (select private.membership_role(organization_id)) in ('owner','admin'))
);
alter policy knowledge_update on public.knowledge_items using (
  (select private.membership_role(organization_id)) in ('owner','admin','editor') and
  (status='draft' or (select private.membership_role(organization_id)) in ('owner','admin'))
) with check (
  (select private.membership_role(organization_id)) in ('owner','admin','editor') and
  (status='draft' or (select private.membership_role(organization_id)) in ('owner','admin'))
);
-- Immutable author-only source snapshots preserve provenance and assessment answers.
create function private.source_key(fields jsonb) returns text
language sql immutable security invoker set search_path='' as $$
  select lower(btrim(regexp_replace(fields->>'Category','\s+',' ','g'))) || chr(31) ||
    lower(btrim(regexp_replace(fields->>'Topic','\s+',' ','g'))) || chr(31) ||
    lower(btrim(regexp_replace(fields->>'Subtopic','\s+',' ','g')));
$$;
create function private.valid_source(fields jsonb) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare expected text[] := array['Topic','Category','Subtopic','Learning Objective','Knowledge Content','Process Steps','Example Scenario','Correct Response','Common Mistakes','Assessment Question','Answer Options','Correct Answer','Difficulty','Source Reference','Effective Date','Last Reviewed','Content Owner']; item record; d text;
begin
  if jsonb_typeof(fields) <> 'object' or not (fields ?& expected) or
    (select count(*) from jsonb_object_keys(fields)) <> 17 then return false; end if;
  for item in select key,value from jsonb_each(fields) loop
    if jsonb_typeof(item.value)<>'string' or char_length(fields->>item.key)>12000 or
      fields->>item.key ~ '^[[:space:]]*[=+@-]' or fields->>item.key ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]' then return false; end if;
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
revoke all on function private.source_key(jsonb),private.valid_source(jsonb) from public,anon;
grant execute on function private.source_key(jsonb),private.valid_source(jsonb) to authenticated;

create table public.knowledge_import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  request_id uuid not null,
  source_name text not null check(char_length(source_name) between 1 and 120),
  record_count integer not null check(record_count between 1 and 200),
  request_digest text not null check(request_digest ~ '^[a-f0-9]{64}$'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(organization_id,id), unique(organization_id,created_by,request_id)
);
create table public.knowledge_source_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  batch_id uuid not null,
  knowledge_id uuid not null,
  source_row integer not null check(source_row between 2 and 201),
  fields jsonb not null check(private.valid_source(fields)),
  source_key text generated always as (private.source_key(fields)) stored,
  created_at timestamptz not null default now(),
  foreign key(organization_id,batch_id) references public.knowledge_import_batches(organization_id,id),
  foreign key(organization_id,knowledge_id) references public.knowledge_items(organization_id,id),
  unique(organization_id,source_key), unique(organization_id,knowledge_id), unique(batch_id,source_row)
);
create index knowledge_imports_creator_idx on public.knowledge_import_batches(created_by);
create index knowledge_sources_batch_idx on public.knowledge_source_records(organization_id,batch_id);
alter table public.knowledge_import_batches enable row level security;
alter table public.knowledge_source_records enable row level security;
revoke all on public.knowledge_import_batches,public.knowledge_source_records from public,anon,authenticated;
grant select,insert on public.knowledge_import_batches,public.knowledge_source_records to authenticated;
create policy import_author_read on public.knowledge_import_batches for select to authenticated
  using((select private.membership_role(organization_id)) in ('owner','admin','editor'));
create policy import_author_insert on public.knowledge_import_batches for insert to authenticated
  with check((select private.membership_role(organization_id)) in ('owner','admin','editor') and created_by=(select auth.uid()));
create policy source_author_read on public.knowledge_source_records for select to authenticated
  using((select private.membership_role(organization_id)) in ('owner','admin','editor'));
create policy source_author_insert on public.knowledge_source_records for insert to authenticated
  with check((select private.membership_role(organization_id)) in ('owner','admin','editor') and exists(
    select 1 from public.knowledge_import_batches b where b.id=batch_id and b.organization_id=knowledge_source_records.organization_id and b.created_by=(select auth.uid())));
create trigger import_audit after insert on public.knowledge_import_batches for each row execute function private.record_audit();

-- Validation checks are scoped by membership and the requested keys; never list another tenant.
create function public.check_knowledge_import(org_id uuid, records jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
begin
  if (select auth.uid()) is null or coalesce(private.membership_role(org_id),'') not in ('owner','admin','editor') then raise exception 'Author access required' using errcode='42501'; end if;
  if jsonb_typeof(records)<>'array' or jsonb_array_length(records) not between 1 and 200 or octet_length(records::text)>2500000 then raise exception 'Invalid record count or size'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('fields',s.fields,'knowledge_id',s.knowledge_id))
    from public.knowledge_source_records s where s.organization_id=org_id and s.source_key in
    (select private.source_key(value) from jsonb_array_elements(records))), '[]'::jsonb);
end;
$$;
create function public.import_knowledge_records(org_id uuid,request_id uuid,source_name text,records jsonb) returns integer
language plpgsql security invoker set search_path='' as $$
declare caller uuid := (select auth.uid()); batch uuid; previous public.knowledge_import_batches; item jsonb; new_id uuid; row_number integer:=1; digest text;
begin
  if caller is null or coalesce(private.membership_role(org_id),'') not in ('owner','admin','editor') then raise exception 'Author access required' using errcode='42501'; end if;
  if request_id is null or source_name is null or char_length(source_name) not between 1 and 120 or jsonb_typeof(records)<>'array' or jsonb_array_length(records) not between 1 and 200 or octet_length(records::text)>2500000 then raise exception 'Invalid import'; end if;
  -- Serialize imports within an organization. A concurrent import cannot slip past validation.
  perform pg_advisory_xact_lock(hashtextextended(org_id::text,0));
  digest := encode(sha256(convert_to(records::text,'UTF8')),'hex');
  select * into previous from public.knowledge_import_batches b where b.organization_id=org_id and b.created_by=caller and b.request_id=import_knowledge_records.request_id;
  if found then
    if previous.request_digest<>digest or previous.source_name<>import_knowledge_records.source_name then raise exception 'Request already used for a different source'; end if;
    return previous.record_count;
  end if;
  for item in select value from jsonb_array_elements(records) loop
    if not private.valid_source(item) then raise exception 'Invalid knowledge record'; end if;
  end loop;
  if (select count(distinct private.source_key(value)) from jsonb_array_elements(records))<>jsonb_array_length(records) or
    jsonb_array_length(public.check_knowledge_import(org_id,records))>0 then raise exception 'Duplicate or conflicting source; review before importing' using errcode='23505'; end if;
  insert into public.knowledge_import_batches(organization_id,request_id,source_name,record_count,request_digest,created_by)
    values(org_id,request_id,source_name,jsonb_array_length(records),digest,caller) returning id into batch;
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
revoke all on function public.check_knowledge_import(uuid,jsonb),public.import_knowledge_records(uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.check_knowledge_import(uuid,jsonb),public.import_knowledge_records(uuid,uuid,text,jsonb) to authenticated;
commit;
