-- Saleschild Phase 0. Apply only to the intended Supabase project.
begin;
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 100),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create table public.memberships (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','editor','learner')),
  created_at timestamptz not null default now(),
  primary key (organization_id,user_id)
);
create index memberships_user_idx on public.memberships(user_id,organization_id);
create index organizations_creator_idx on public.organizations(created_by);

-- A narrow definer lookup prevents recursive membership RLS. Membership is
-- read from the database; user-editable JWT metadata is never authorization.
create function private.membership_role(org_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select role from public.memberships
  where organization_id = org_id and user_id = (select auth.uid())
    and (select auth.uid()) is not null;
$$;
revoke all on function private.membership_role(uuid) from public,anon;
grant execute on function private.membership_role(uuid) to authenticated;

create table public.knowledge_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  title text not null check (char_length(btrim(title)) between 3 and 160),
  body text not null check (char_length(btrim(body)) between 20 and 20000),
  source_url text check (source_url is null or (char_length(source_url) <= 2048 and source_url ~ '^https://[^[:space:]]+$')),
  status text not null default 'draft' check (status in ('draft','published')),
  evidence_status text not null default 'Unverified' check (evidence_status in ('Verified','Internally Approved','Unverified','Conflicting','Expired','Not Applicable')),
  current_version integer not null default 1 check (current_version > 0),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,id)
);
create index knowledge_organization_idx on public.knowledge_items(organization_id,status,created_at desc);
create index knowledge_creator_idx on public.knowledge_items(created_by);
create table public.knowledge_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  knowledge_id uuid not null,
  version integer not null,
  title text not null, body text not null, source_url text,
  status text not null, evidence_status text not null,
  recorded_at timestamptz not null default now(),
  foreign key (organization_id,knowledge_id) references public.knowledge_items(organization_id,id),
  unique (knowledge_id,version)
);
create index knowledge_versions_org_idx on public.knowledge_versions(organization_id,knowledge_id);

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  title text not null check (char_length(btrim(title)) between 3 and 160),
  description text not null check (char_length(btrim(description)) between 10 and 2000),
  status text not null default 'draft' check (status in ('draft','published')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (organization_id,id)
);
create index courses_org_idx on public.courses(organization_id,status,created_at desc);
create index courses_creator_idx on public.courses(created_by);
create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  course_id uuid not null,
  title text not null check (char_length(btrim(title)) between 3 and 160),
  body text not null check (char_length(body) between 1 and 20000),
  position integer not null check (position >= 0),
  created_at timestamptz not null default now(),
  foreign key (organization_id,course_id) references public.courses(organization_id,id),
  unique(course_id,position)
);
create index lessons_org_course_idx on public.lessons(organization_id,course_id);
create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  course_id uuid not null,
  user_id uuid not null,
  status text not null default 'not_started' check (status in ('not_started','in_progress','completed')),
  created_at timestamptz not null default now(),
  foreign key (organization_id,course_id) references public.courses(organization_id,id),
  foreign key (organization_id,user_id) references public.memberships(organization_id,user_id),
  unique(course_id,user_id)
);
create index enrollments_org_user_idx on public.enrollments(organization_id,user_id);
create index enrollments_user_idx on public.enrollments(user_id);

-- Published assessment rows are immutable. New versions are new rows linked by
-- a stable series_id. No answer keys are stored in learner-readable tables.
create table public.assessments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  course_id uuid,
  series_id uuid not null default gen_random_uuid(),
  version integer not null default 1 check (version > 0),
  title text not null check (char_length(btrim(title)) between 3 and 160),
  description text not null check (char_length(description) <= 2000),
  status text not null default 'draft' check (status in ('draft','published')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (organization_id,course_id) references public.courses(organization_id,id),
  unique (organization_id,id), unique(organization_id,series_id,version)
);
create index assessments_org_idx on public.assessments(organization_id,status);
create index assessments_course_idx on public.assessments(organization_id,course_id);
create index assessments_creator_idx on public.assessments(created_by);
create table public.assessment_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  assessment_id uuid not null,
  user_id uuid not null,
  responses jsonb not null default '{}'::jsonb,
  submitted_at timestamptz not null default now(),
  foreign key (organization_id,assessment_id) references public.assessments(organization_id,id),
  foreign key (organization_id,user_id) references public.memberships(organization_id,user_id),
  check (octet_length(responses::text) <= 100000)
);
create index attempts_org_user_idx on public.assessment_attempts(organization_id,user_id);
create index attempts_assessment_idx on public.assessment_attempts(organization_id,assessment_id);
create index attempts_user_idx on public.assessment_attempts(user_id);

create table public.ai_workflows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  requested_by uuid not null,
  objective text not null check (char_length(btrim(objective)) between 10 and 2000),
  mode text not null check (mode in ('manual','assisted')),
  status text not null default 'draft' check (status = 'draft'),
  created_at timestamptz not null default now(),
  foreign key (organization_id,requested_by) references public.memberships(organization_id,user_id)
);
create index workflows_org_user_idx on public.ai_workflows(organization_id,requested_by);
create index workflows_requester_idx on public.ai_workflows(requested_by);
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  user_id uuid not null,
  title text not null check (char_length(title) <= 160),
  body text not null check (char_length(body) <= 2000),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (organization_id,user_id) references public.memberships(organization_id,user_id)
);
create index notifications_org_user_idx on public.notifications(organization_id,user_id,created_at desc);
create index notifications_user_idx on public.notifications(user_id);
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  entity_type text not null,
  entity_id uuid not null,
  created_at timestamptz not null default now()
);
create index audit_org_time_idx on public.audit_events(organization_id,created_at desc);
create index audit_actor_idx on public.audit_events(actor_id);

-- Atomic, verified-user-only bootstrap. The definer is required because ordinary
-- users intentionally cannot insert organizations or grant membership roles.
create function private.create_organization(organization_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare org_id uuid; caller uuid := auth.uid();
begin
  if caller is null or not exists(select 1 from auth.users where id=caller and email_confirmed_at is not null) then
    raise exception 'Verified identity required' using errcode='42501';
  end if;
  if char_length(btrim(organization_name)) not between 2 and 100 then raise exception 'Invalid organization name'; end if;
  perform pg_advisory_xact_lock(hashtextextended(caller::text,0));
  if exists(select 1 from public.memberships where user_id=caller) then raise exception 'Workspace already exists'; end if;
  insert into public.organizations(name,created_by) values(btrim(organization_name),caller) returning id into org_id;
  insert into public.memberships(organization_id,user_id,role) values(org_id,caller,'owner');
  insert into public.notifications(organization_id,user_id,title,body) values(org_id,caller,'A new beginning.','Welcome to your organization’s Saleschild workspace. Start with a knowledge resource or a draft learning path.');
  insert into public.audit_events(organization_id,actor_id,event_type,entity_type,entity_id) values(org_id,caller,'created','organization',org_id);
  return org_id;
end;
$$;
revoke all on function private.create_organization(text) from public,anon;
grant execute on function private.create_organization(text) to authenticated;
create function public.create_organization(organization_name text) returns uuid
language sql security invoker set search_path = '' as $$ select private.create_organization(organization_name); $$;
revoke all on function public.create_organization(text) from public,anon;
grant execute on function public.create_organization(text) to authenticated;

create function private.version_knowledge() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='UPDATE' then
    if new.organization_id<>old.organization_id or new.id<>old.id or new.created_by<>old.created_by then raise exception 'Record identity is immutable'; end if;
    new.current_version:=old.current_version+1; new.updated_at:=now();
  else new.current_version:=1;
  end if;
  return new;
end; $$;
create trigger knowledge_version_before before insert or update on public.knowledge_items for each row execute function private.version_knowledge();
create function private.snapshot_knowledge() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.knowledge_versions(organization_id,knowledge_id,version,title,body,source_url,status,evidence_status)
  values(new.organization_id,new.id,new.current_version,new.title,new.body,new.source_url,new.status,new.evidence_status);
  return new;
end; $$;
create trigger knowledge_snapshot after insert or update on public.knowledge_items for each row execute function private.snapshot_knowledge();
create function private.record_audit() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_events(organization_id,actor_id,event_type,entity_type,entity_id)
  values(coalesce((to_jsonb(new)->>'organization_id')::uuid,new.id),auth.uid(),lower(tg_op),tg_table_name,new.id);
  return new;
end; $$;
create trigger knowledge_audit after insert or update on public.knowledge_items for each row execute function private.record_audit();
create trigger course_audit after insert or update on public.courses for each row execute function private.record_audit();
create trigger workflow_audit after insert on public.ai_workflows for each row execute function private.record_audit();
create trigger organization_audit after update on public.organizations for each row execute function private.record_audit();
create function private.immutable_assessment() returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status='published' then raise exception 'Published assessments are immutable; create a new version'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end; $$;
create trigger immutable_published_assessment before update or delete on public.assessments for each row execute function private.immutable_assessment();
revoke all on function private.version_knowledge(),private.snapshot_knowledge(),private.record_audit(),private.immutable_assessment() from public,anon,authenticated;

-- Every exposed table is explicitly granted and protected, including tables
-- created on Supabase projects without automatic Data API exposure.
alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.knowledge_items enable row level security;
alter table public.knowledge_versions enable row level security;
alter table public.courses enable row level security;
alter table public.lessons enable row level security;
alter table public.enrollments enable row level security;
alter table public.assessments enable row level security;
alter table public.assessment_attempts enable row level security;
alter table public.ai_workflows enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_events enable row level security;
revoke all on public.organizations,public.memberships,public.knowledge_items,public.knowledge_versions,public.courses,public.lessons,public.enrollments,public.assessments,public.assessment_attempts,public.ai_workflows,public.notifications,public.audit_events from anon,authenticated;
grant select on public.organizations,public.memberships,public.knowledge_items,public.knowledge_versions,public.courses,public.lessons,public.enrollments,public.assessments,public.assessment_attempts,public.ai_workflows,public.notifications,public.audit_events to authenticated;
grant update(name) on public.organizations to authenticated;
grant insert(organization_id,title,body,source_url,status,created_by) on public.knowledge_items to authenticated;
grant update(title,body,source_url,status) on public.knowledge_items to authenticated;
grant insert(organization_id,title,description,status,created_by) on public.courses to authenticated;
grant update(title,description) on public.courses to authenticated;
grant insert(organization_id,course_id,title,body,position) on public.lessons to authenticated;
grant update(title,body,position) on public.lessons to authenticated;
grant insert(organization_id,course_id,series_id,version,title,description,status,created_by) on public.assessments to authenticated;
grant update(title,description,status) on public.assessments to authenticated;
grant insert(organization_id,requested_by,objective,mode,status) on public.ai_workflows to authenticated;
grant update(read_at) on public.notifications to authenticated;

create policy organization_read on public.organizations for select to authenticated using ((select private.membership_role(id)) is not null);
create policy organization_update on public.organizations for update to authenticated using ((select private.membership_role(id)) in ('owner','admin')) with check ((select private.membership_role(id)) in ('owner','admin'));
create policy membership_read on public.memberships for select to authenticated using (user_id=(select auth.uid()) or (select private.membership_role(organization_id)) in ('owner','admin'));
create policy knowledge_read on public.knowledge_items for select to authenticated using ((select private.membership_role(organization_id)) is not null and (status='published' or (select private.membership_role(organization_id)) in ('owner','admin','editor')));
create policy knowledge_insert on public.knowledge_items for insert to authenticated with check ((select private.membership_role(organization_id)) in ('owner','admin','editor') and created_by=(select auth.uid()));
create policy knowledge_update on public.knowledge_items for update to authenticated using ((select private.membership_role(organization_id)) in ('owner','admin','editor')) with check ((select private.membership_role(organization_id)) in ('owner','admin','editor'));
create policy versions_read on public.knowledge_versions for select to authenticated using ((select private.membership_role(organization_id)) is not null and (status='published' or (select private.membership_role(organization_id)) in ('owner','admin','editor')));
create policy course_read on public.courses for select to authenticated using ((select private.membership_role(organization_id)) is not null and (status='published' or (select private.membership_role(organization_id)) in ('owner','admin','editor')));
create policy course_insert on public.courses for insert to authenticated with check ((select private.membership_role(organization_id)) in ('owner','admin','editor') and created_by=(select auth.uid()) and status='draft');
create policy course_update on public.courses for update to authenticated using ((select private.membership_role(organization_id)) in ('owner','admin','editor')) with check ((select private.membership_role(organization_id)) in ('owner','admin','editor'));
create policy lesson_read on public.lessons for select to authenticated using (exists(select 1 from public.courses c where c.id=course_id and c.organization_id=lessons.organization_id));
create policy lesson_insert on public.lessons for insert to authenticated with check ((select private.membership_role(organization_id)) in ('owner','admin','editor'));
create policy lesson_update on public.lessons for update to authenticated using ((select private.membership_role(organization_id)) in ('owner','admin','editor')) with check ((select private.membership_role(organization_id)) in ('owner','admin','editor'));
create policy enrollment_read on public.enrollments for select to authenticated using ((select private.membership_role(organization_id)) is not null and (user_id=(select auth.uid()) or (select private.membership_role(organization_id)) in ('owner','admin')));
create policy assessment_read on public.assessments for select to authenticated using ((select private.membership_role(organization_id)) is not null and (status='published' or (select private.membership_role(organization_id)) in ('owner','admin','editor')));
create policy assessment_insert on public.assessments for insert to authenticated with check ((select private.membership_role(organization_id)) in ('owner','admin','editor') and created_by=(select auth.uid()));
create policy assessment_update on public.assessments for update to authenticated using ((select private.membership_role(organization_id)) in ('owner','admin','editor')) with check ((select private.membership_role(organization_id)) in ('owner','admin','editor'));
create policy attempt_read on public.assessment_attempts for select to authenticated using ((select private.membership_role(organization_id)) is not null and (user_id=(select auth.uid()) or (select private.membership_role(organization_id)) in ('owner','admin')));
create policy workflow_read on public.ai_workflows for select to authenticated using ((select private.membership_role(organization_id)) is not null and (requested_by=(select auth.uid()) or (select private.membership_role(organization_id)) in ('owner','admin')));
create policy workflow_insert on public.ai_workflows for insert to authenticated with check ((select private.membership_role(organization_id)) in ('owner','admin','editor') and requested_by=(select auth.uid()) and status='draft' and mode in ('manual','assisted'));
create policy notification_read on public.notifications for select to authenticated using ((select private.membership_role(organization_id)) is not null and user_id=(select auth.uid()));
create policy notification_update on public.notifications for update to authenticated using ((select private.membership_role(organization_id)) is not null and user_id=(select auth.uid())) with check ((select private.membership_role(organization_id)) is not null and user_id=(select auth.uid()));
create policy audit_read on public.audit_events for select to authenticated using ((select private.membership_role(organization_id)) in ('owner','admin'));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('organization-knowledge','organization-knowledge',false,10485760,array['application/pdf','text/plain','text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);
create function private.storage_role(object_name text) returns text language sql stable security invoker set search_path = '' as $$
  select case when split_part(object_name,'/',1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    and array_length(string_to_array(object_name,'/'),1) >= 2
    and split_part(object_name,'/',2) <> ''
    and object_name !~ '(^|/)\.{1,2}(/|$)'
  then private.membership_role(split_part(object_name,'/',1)::uuid) else null end;
$$;
revoke all on function private.storage_role(text) from public,anon;
grant execute on function private.storage_role(text) to authenticated;
-- Raw ingestion sources are author-only. A future published-attachment mapping
-- must enforce resource visibility before learners may receive signed URLs.
create policy organization_files_read on storage.objects for select to authenticated using (bucket_id='organization-knowledge' and (select private.storage_role(name)) in ('owner','admin','editor'));
create policy organization_files_insert on storage.objects for insert to authenticated with check (bucket_id='organization-knowledge' and (select private.storage_role(name)) in ('owner','admin','editor'));
create policy organization_files_update on storage.objects for update to authenticated using (bucket_id='organization-knowledge' and (select private.storage_role(name)) in ('owner','admin','editor')) with check (bucket_id='organization-knowledge' and (select private.storage_role(name)) in ('owner','admin','editor'));
create policy organization_files_delete on storage.objects for delete to authenticated using (bucket_id='organization-knowledge' and (select private.storage_role(name)) in ('owner','admin','editor'));
commit;
