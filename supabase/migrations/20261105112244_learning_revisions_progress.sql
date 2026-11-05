-- Versioned Learning Paths and source-consumption progress. Review before applying.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
-- Retain existing lesson IDs while enforcing tenant-coherent snapshot links.
alter table public.lessons add constraint lessons_tenant_identity unique(organization_id,id);
create table public.learning_path_revisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  course_id uuid not null,
  number integer not null check(number>0),
  title text not null,
  description text not null,
  content_fingerprint text not null,
  published_by uuid not null references auth.users(id),
  published_at timestamptz not null default now(),
  foreign key(organization_id,course_id) references public.courses(organization_id,id),
  unique(organization_id,id), unique(course_id,number)
);
create index learning_revisions_org_course on public.learning_path_revisions(organization_id,course_id,number desc);
create index learning_revisions_fingerprint on public.learning_path_revisions(course_id,content_fingerprint);
create index learning_revisions_publisher on public.learning_path_revisions(published_by);
create table public.learning_revision_units (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  revision_id uuid not null,
  lesson_id uuid not null,
  title text not null, body text not null,
  position integer not null check(position>=0),
  source_knowledge_id uuid not null,
  source_version integer not null,
  source_fields jsonb not null check(private.valid_gateway_fields(source_fields)),
  foreign key(organization_id,revision_id) references public.learning_path_revisions(organization_id,id),
  foreign key(organization_id,lesson_id) references public.lessons(organization_id,id),
  foreign key(organization_id,source_knowledge_id,source_version) references public.knowledge_versions(organization_id,knowledge_id,version),
  unique(organization_id,revision_id,id), unique(revision_id,position), unique(revision_id,lesson_id)
);
create index learning_revision_units_source on public.learning_revision_units(organization_id,source_knowledge_id,source_version);
create index learning_revision_units_lesson on public.learning_revision_units(organization_id,lesson_id);
create table public.learning_unit_progress (
  organization_id uuid not null references public.organizations(id),
  revision_id uuid not null,
  unit_id uuid not null,
  user_id uuid not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  checkpoint_passed boolean not null default false,
  resume_step integer not null default 0 check(resume_step between 0 and 2),
  updated_at timestamptz not null default now(),
  foreign key(organization_id,revision_id,unit_id) references public.learning_revision_units(organization_id,revision_id,id),
  foreign key(organization_id,user_id) references public.memberships(organization_id,user_id),
  primary key(unit_id,user_id),
  check((completed_at is null and not checkpoint_passed) or (completed_at is not null and checkpoint_passed)),
  check(completed_at is null or completed_at>=started_at)
);
create index learning_progress_org_user_revision on public.learning_unit_progress(organization_id,user_id,revision_id);
create index learning_progress_revision on public.learning_unit_progress(organization_id,revision_id,updated_at);
alter table public.learning_path_revisions enable row level security;
alter table public.learning_revision_units enable row level security;
alter table public.learning_unit_progress enable row level security;
revoke all on public.learning_path_revisions,public.learning_revision_units,public.learning_unit_progress from public,anon,authenticated;
grant select on public.learning_path_revisions,public.learning_revision_units,public.learning_unit_progress to authenticated;
create policy learning_revision_read on public.learning_path_revisions for select to authenticated using((select private.membership_role(organization_id)) is not null);
create policy learning_unit_read on public.learning_revision_units for select to authenticated using((select private.membership_role(organization_id)) is not null);
create policy learning_progress_read on public.learning_unit_progress for select to authenticated using((select private.membership_role(organization_id)) is not null and(user_id=(select auth.uid()) or (select private.membership_role(organization_id))='owner'));

-- Published snapshots are immutable even to future accidentally broadened grants.
create function private.immutable_learning_snapshot() returns trigger language plpgsql security invoker set search_path='' as $$
begin raise exception 'Published learning snapshots are immutable' using errcode='42501'; end; $$;
revoke all on function private.immutable_learning_snapshot() from public,anon,authenticated;
create trigger immutable_learning_revision before update or delete on public.learning_path_revisions for each row execute function private.immutable_learning_snapshot();
create trigger immutable_learning_unit before update or delete on public.learning_revision_units for each row execute function private.immutable_learning_snapshot();

-- These narrowly scoped definer helpers are necessary because customers cannot
-- write release snapshots, enrollments or progress facts directly. All callers
-- are checked against trusted current membership, not editable JWT metadata.
create function private.publish_learning_revision(org_id uuid,course_id uuid,expected_lesson_ids uuid[]) returns uuid
language plpgsql security definer set search_path='' as $$
declare caller uuid:=(select auth.uid()); target public.courses; actual_ids uuid[]; fingerprint text; revision uuid; next_number integer;
begin
 if caller is null or coalesce(private.membership_role(org_id),'') not in('owner','admin') then raise exception 'Learning publication requires an owner or administrator' using errcode='42501'; end if;
 if expected_lesson_ids is null or cardinality(expected_lesson_ids) not between 1 and 500 or array_position(expected_lesson_ids,null) is not null then raise exception 'Review 1–500 approved source lessons' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(org_id::text,0));
 select * into target from public.courses c where c.organization_id=org_id and c.id=course_id for update;
 if not found then raise exception 'Learning path not found' using errcode='42501'; end if;
 -- Ordinary field/position updates do not take the advisory lock; lock the
 -- exact composition and current source rows before validation and snapshotting.
 perform 1 from public.lessons l where l.organization_id=org_id and l.course_id=target.id order by l.id for share;
 perform 1 from public.knowledge_items k where k.organization_id=org_id and exists(select 1 from public.lessons l where l.organization_id=org_id and l.course_id=target.id and l.source_knowledge_id=k.id) order by k.id for share;
 select array_agg(l.id order by l.position,l.id) into actual_ids from public.lessons l where l.organization_id=org_id and l.course_id=publish_learning_revision.course_id;
 if actual_ids is distinct from expected_lesson_ids then raise exception 'Learning composition changed; reopen the path before publishing' using errcode='40001'; end if;
 if exists(select 1 from public.lessons l left join public.knowledge_versions v on v.organization_id=l.organization_id and v.knowledge_id=l.source_knowledge_id and v.version=l.source_version left join public.knowledge_items k on k.organization_id=l.organization_id and k.id=l.source_knowledge_id
  where l.organization_id=org_id and l.course_id=publish_learning_revision.course_id and(l.source_knowledge_id is null or v.status is distinct from 'published' or k.status is distinct from 'published' or l.title is distinct from v.title or l.body is distinct from v.body)) then
  raise exception 'Every lesson must match an approved source version; review legacy or changed sources first' using errcode='22023';
 end if;
 select encode(sha256(convert_to(jsonb_build_object('title',target.title,'description',target.description,'units',jsonb_agg(jsonb_build_array(l.id,l.title,l.body,l.position,l.source_knowledge_id,l.source_version) order by l.position,l.id))::text,'UTF8')),'hex') into fingerprint
  from public.lessons l where l.organization_id=org_id and l.course_id=publish_learning_revision.course_id;
 select r.id into revision from public.learning_path_revisions r where r.organization_id=org_id and r.course_id=publish_learning_revision.course_id and r.content_fingerprint=fingerprint and r.number=(select max(latest.number) from public.learning_path_revisions latest where latest.course_id=target.id);
 if found then
  if target.status<>'published' then update public.courses set status='published' where id=target.id; end if;
  return revision;
 end if;
 select coalesce(max(r.number),0)+1 into next_number from public.learning_path_revisions r where r.course_id=publish_learning_revision.course_id;
 insert into public.learning_path_revisions(organization_id,course_id,number,title,description,content_fingerprint,published_by) values(org_id,target.id,next_number,target.title,target.description,fingerprint,caller) returning id into revision;
 insert into public.learning_revision_units(organization_id,revision_id,lesson_id,title,body,position,source_knowledge_id,source_version,source_fields)
  select org_id,revision,l.id,l.title,l.body,l.position,l.source_knowledge_id,l.source_version,v.custom_fields from public.lessons l join public.knowledge_versions v on v.organization_id=l.organization_id and v.knowledge_id=l.source_knowledge_id and v.version=l.source_version where l.organization_id=org_id and l.course_id=target.id order by l.position,l.id;
 update public.courses set status='published' where id=target.id;
 update public.enrollments set status='not_started' where organization_id=org_id and enrollments.course_id=target.id;
 insert into public.audit_events(organization_id,actor_id,event_type,entity_type,entity_id) values(org_id,caller,'published','learning_path_revision',revision);
 return revision;
end; $$;
create function public.publish_learning_revision(org_id uuid,course_id uuid,expected_lesson_ids uuid[]) returns uuid language sql security invoker set search_path='' as $$ select private.publish_learning_revision(org_id,course_id,expected_lesson_ids); $$;

create function private.begin_learning_revision(org_id uuid,course_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare target public.courses;
begin
 if (select auth.uid()) is null or coalesce(private.membership_role(org_id),'') not in('owner','admin') then raise exception 'Publication review access required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(org_id::text,0));
 select * into target from public.courses c where c.organization_id=org_id and c.id=course_id for update;
 if not found then raise exception 'Learning path not found' using errcode='42501'; end if;
 if not exists(select 1 from public.learning_path_revisions r where r.organization_id=org_id and r.course_id=target.id) then raise exception 'Publish the first reviewed revision before preparing another' using errcode='22023'; end if;
 if target.status='published' then update public.courses set status='draft' where id=target.id; end if;
 return true;
end; $$;
create function public.begin_learning_revision(org_id uuid,course_id uuid) returns boolean language sql security invoker set search_path='' as $$ select private.begin_learning_revision(org_id,course_id); $$;

-- Members can still open the released snapshot while authors review new sources.
alter policy course_read on public.courses using((select private.membership_role(organization_id)) is not null and(status='published' or (select private.membership_role(organization_id)) in('owner','admin','editor') or exists(select 1 from public.learning_path_revisions r where r.organization_id=courses.organization_id and r.course_id=courses.id)));
alter policy lesson_read on public.lessons using((select private.membership_role(organization_id)) in('owner','admin','editor') or ((select private.membership_role(organization_id))='learner' and exists(select 1 from public.courses c where c.organization_id=lessons.organization_id and c.id=lessons.course_id and c.status='published')));

create function public.read_learning_revision(org_id uuid,course_id uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare revision public.learning_path_revisions; role_name text:=private.membership_role(org_id);
begin
 if (select auth.uid()) is null or role_name is null then raise exception 'Organization access required' using errcode='42501'; end if;
 select * into revision from public.learning_path_revisions r where r.organization_id=org_id and r.course_id=read_learning_revision.course_id order by r.number desc limit 1;
 if not found then return null; end if;
 return jsonb_build_object('revision',jsonb_build_object('id',revision.id,'course_id',revision.course_id,'number',revision.number,'title',revision.title,'published_at',revision.published_at),
  'units',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'lesson_id',u.lesson_id,'title',u.title,'body',u.body,'position',u.position,'source_knowledge_id',u.source_knowledge_id,'source_version',u.source_version,'source_fields',u.source_fields) order by u.position,u.id) from public.learning_revision_units u where u.organization_id=org_id and u.revision_id=revision.id),'[]'::jsonb),
  'progress',case when role_name='learner' then coalesce((select jsonb_agg(jsonb_build_object('unit_id',p.unit_id,'started_at',p.started_at,'completed_at',p.completed_at,'checkpoint_passed',p.checkpoint_passed,'resume_step',p.resume_step,'updated_at',p.updated_at)) from public.learning_unit_progress p where p.organization_id=org_id and p.revision_id=revision.id and p.user_id=(select auth.uid())),'[]'::jsonb) else '[]'::jsonb end);
end; $$;

create or replace function public.read_learning_path(org_id uuid,course_id uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare target public.courses; released public.learning_path_revisions; role_name text:=private.membership_role(org_id);
begin
 if (select auth.uid()) is null or role_name is null then raise exception 'Organization access required' using errcode='42501'; end if;
 select * into target from public.courses c where c.id=course_id and c.organization_id=org_id;
 if not found then return null; end if;
 if role_name='learner' then
  select * into released from public.learning_path_revisions r where r.organization_id=org_id and r.course_id=read_learning_path.course_id order by r.number desc limit 1;
  if not found then return null; end if;
  return jsonb_build_object('course',jsonb_build_object('id',target.id,'title',released.title,'description',released.description,'status','published'),'lessons',coalesce((select jsonb_agg(jsonb_build_object('id',u.lesson_id,'title',u.title,'body',u.body,'position',u.position,'source_knowledge_id',u.source_knowledge_id,'source_version',u.source_version,'source_fields',u.source_fields) order by u.position,u.id) from public.learning_revision_units u where u.organization_id=org_id and u.revision_id=released.id),'[]'::jsonb));
 end if;
 return jsonb_build_object('course',jsonb_build_object('id',target.id,'title',target.title,'description',target.description,'status',target.status),'lessons',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'title',l.title,'body',l.body,'position',l.position,'source_knowledge_id',l.source_knowledge_id,'source_version',l.source_version,'source_fields',coalesce(v.custom_fields,'[]'::jsonb)) order by l.position) from public.lessons l left join public.knowledge_versions v on v.organization_id=l.organization_id and v.knowledge_id=l.source_knowledge_id and v.version=l.source_version where l.organization_id=org_id and l.course_id=read_learning_path.course_id),'[]'::jsonb));
end; $$;

create function private.record_learning_progress(org_id uuid,revision_id uuid,unit_id uuid,action text,step integer,evidence text) returns jsonb language plpgsql security definer set search_path='' as $$
declare caller uuid:=(select auth.uid()); unit public.learning_revision_units; revision public.learning_path_revisions; saved public.learning_unit_progress; expected text; course_status text; total integer; done integer; saved_at timestamptz;
begin
 if caller is null or private.membership_role(org_id) is distinct from 'learner' then raise exception 'Only active members record learning progress' using errcode='42501'; end if;
 if action is null or action not in('start','resume','complete') or step is null or step not between 0 and 2 or (evidence is not null and char_length(evidence)>2000) then raise exception 'Invalid progress action' using errcode='22023'; end if;
 -- Serialize a member's writes and publication against the same org lock.
 perform pg_advisory_xact_lock(hashtextextended(org_id::text,0));
 select * into revision from public.learning_path_revisions r where r.organization_id=org_id and r.id=revision_id;
 if not found then raise exception 'Published revision not available' using errcode='42501'; end if;
 if exists(select 1 from public.learning_path_revisions r where r.organization_id=org_id and r.course_id=revision.course_id and r.number>revision.number) then raise exception 'A newer published revision is available; reopen the path' using errcode='40001'; end if;
 select * into unit from public.learning_revision_units u where u.organization_id=org_id and u.revision_id=record_learning_progress.revision_id and u.id=unit_id;
 if not found then raise exception 'Unit does not belong to this revision' using errcode='42501'; end if;
 if action='complete' then
  select btrim(f->>'value') into expected from jsonb_array_elements(unit.source_fields) with ordinality a(f,n) where btrim(f->>'value')<>'' and char_length(btrim(f->>'value'))<=500 order by n limit 1;
  expected:=coalesce(expected,left(btrim(unit.body),2000));
  if evidence is null or evidence is distinct from expected then raise exception 'Review the approved source and choose its exact documented evidence' using errcode='22023'; end if;
 end if;
 saved_at:=clock_timestamp();
 insert into public.learning_unit_progress(organization_id,revision_id,unit_id,user_id,checkpoint_passed,completed_at,resume_step,started_at,updated_at)
  values(org_id,revision_id,unit_id,caller,action='complete',case when action='complete' then saved_at end,step,saved_at,saved_at)
 on conflict on constraint learning_unit_progress_pkey do update set
  completed_at=coalesce(learning_unit_progress.completed_at,excluded.completed_at),
  checkpoint_passed=learning_unit_progress.checkpoint_passed or excluded.checkpoint_passed,
  resume_step=case when learning_unit_progress.completed_at is not null then learning_unit_progress.resume_step else excluded.resume_step end,
  updated_at=saved_at
 where (action<>'start' and learning_unit_progress.completed_at is null and(excluded.completed_at is not null or learning_unit_progress.resume_step is distinct from excluded.resume_step or (action='resume' and exists(select 1 from public.learning_unit_progress recent where recent.organization_id=org_id and recent.revision_id=record_learning_progress.revision_id and recent.user_id=caller and recent.unit_id<>record_learning_progress.unit_id and recent.updated_at>learning_unit_progress.updated_at))));
 select * into saved from public.learning_unit_progress p where p.unit_id=record_learning_progress.unit_id and p.user_id=caller;
 select count(*),count(p.completed_at) into total,done from public.learning_revision_units u left join public.learning_unit_progress p on p.unit_id=u.id and p.user_id=caller where u.organization_id=org_id and u.revision_id=revision.id;
 course_status:=case when done=total then 'completed' else 'in_progress' end;
 insert into public.enrollments(organization_id,course_id,user_id,status) values(org_id,revision.course_id,caller,course_status)
 on conflict(course_id,user_id) do update set status=excluded.status where enrollments.status is distinct from excluded.status;
 return jsonb_build_object('unit_id',saved.unit_id,'started_at',saved.started_at,'completed_at',saved.completed_at,'checkpoint_passed',saved.checkpoint_passed,'resume_step',saved.resume_step,'updated_at',saved.updated_at);
end; $$;
create function public.record_learning_progress(org_id uuid,revision_id uuid,unit_id uuid,action text,step integer,evidence text default null) returns jsonb language sql security invoker set search_path='' as $$ select private.record_learning_progress(org_id,revision_id,unit_id,action,step,evidence); $$;

create type public.learning_progress_summary as(user_id uuid,course_id uuid,revision_id uuid,path_title text,revision_number integer,total_units bigint,completed_units bigint,started_at timestamptz,last_activity_at timestamptz,completed_at timestamptz);

-- One authoritative progress store. Date filters count completions in the
-- inclusive period; total_units remains the full current revision denominator.
-- Zero-activity member/path rows remain visible. Login/presence is not progress.
create function private.read_learning_progress(org_id uuid,member_id uuid,course_id uuid,from_date date,to_date date)
returns setof public.learning_progress_summary
language plpgsql stable security definer set search_path='' as $$
declare caller uuid:=(select auth.uid()); role_name text:=private.membership_role(org_id);
begin
 if caller is null or role_name is null or role_name not in('owner','learner') then raise exception 'Owner analytics or personal member progression required' using errcode='42501'; end if;
 if from_date is not null and to_date is not null and from_date>to_date then raise exception 'Choose an ordered date range' using errcode='22023'; end if;
 if role_name='learner' and member_id is not null and member_id<>caller then raise exception 'Members can read only their own progression' using errcode='42501'; end if;
 if member_id is not null and not exists(select 1 from public.memberships m where m.organization_id=org_id and m.user_id=member_id and m.role='learner' and m.lifecycle='active' and not m.password_change_required and m.revoked_at is null) then raise exception 'Member not available in this organization' using errcode='42501'; end if;
 if course_id is not null and not exists(select 1 from public.courses c where c.organization_id=org_id and c.id=course_id) then raise exception 'Path not available in this organization' using errcode='42501'; end if;
 return query with latest as(
  select distinct on(r.course_id)r.* from public.learning_path_revisions r where r.organization_id=org_id and(read_learning_progress.course_id is null or r.course_id=read_learning_progress.course_id) order by r.course_id,r.number desc
 ), members as(
  select m.user_id from public.memberships m where m.organization_id=org_id and m.role='learner' and m.lifecycle='active' and not m.password_change_required and m.revoked_at is null and(role_name='owner' or m.user_id=caller) and(member_id is null or m.user_id=member_id)
 ) select m.user_id,r.course_id,r.id,r.title,r.number,count(u.id),
  count(p.completed_at) filter(where(from_date is null or p.completed_at>=(from_date::timestamp at time zone 'UTC'))and(to_date is null or p.completed_at<((to_date+1)::timestamp at time zone 'UTC'))),
  min(p.started_at),max(p.updated_at),case when count(p.completed_at)=count(u.id) then max(p.completed_at) end
 from latest r cross join members m join public.learning_revision_units u on u.organization_id=org_id and u.revision_id=r.id
 left join public.learning_unit_progress p on p.organization_id=org_id and p.unit_id=u.id and p.user_id=m.user_id
 group by m.user_id,r.course_id,r.id,r.title,r.number;
end; $$;
create function public.read_learning_progress(org_id uuid,member_id uuid default null,course_id uuid default null,from_date date default null,to_date date default null)
returns setof public.learning_progress_summary
language sql stable security invoker set search_path='' as $$ select * from private.read_learning_progress(org_id,member_id,course_id,from_date,to_date); $$;

create function public.search_approved_knowledge(org_id uuid,query_text text,result_limit integer default 5)
returns table(id uuid,title text,body text,current_version integer,custom_fields jsonb)
language plpgsql stable security invoker set search_path='' as $$
declare terms text[];
begin
 if (select auth.uid()) is null or private.membership_role(org_id) is null then raise exception 'Organization access required' using errcode='42501'; end if;
 if query_text is null or char_length(btrim(query_text)) not between 2 and 200 or result_limit is null or result_limit not between 1 and 10 then raise exception 'Search 2–200 characters, requesting at most ten sources' using errcode='22023'; end if;
 terms:=regexp_split_to_array(lower(btrim(query_text)),E'\\s+');
 if cardinality(terms)>12 then raise exception 'Use at most twelve search terms' using errcode='22023'; end if;
 return query select k.id,k.title,k.body,k.current_version,k.custom_fields from public.knowledge_items k
  where k.organization_id=org_id and k.status='published' and not exists(select 1 from unnest(terms)t where strpos(lower(k.title||' '||k.body||' '||k.custom_fields::text),t)=0)
  order by case when strpos(lower(k.title),lower(btrim(query_text)))>0 then 0 else 1 end,k.title,k.id limit result_limit;
end; $$;

revoke all on function private.publish_learning_revision(uuid,uuid,uuid[]),private.begin_learning_revision(uuid,uuid),private.record_learning_progress(uuid,uuid,uuid,text,integer,text),private.read_learning_progress(uuid,uuid,uuid,date,date) from public,anon;
grant execute on function private.publish_learning_revision(uuid,uuid,uuid[]),private.begin_learning_revision(uuid,uuid),private.record_learning_progress(uuid,uuid,uuid,text,integer,text),private.read_learning_progress(uuid,uuid,uuid,date,date) to authenticated;
revoke all on function public.publish_learning_revision(uuid,uuid,uuid[]),public.begin_learning_revision(uuid,uuid),public.read_learning_revision(uuid,uuid),public.record_learning_progress(uuid,uuid,uuid,text,integer,text),public.read_learning_progress(uuid,uuid,uuid,date,date),public.search_approved_knowledge(uuid,text,integer) from public,anon;
grant execute on function public.publish_learning_revision(uuid,uuid,uuid[]),public.begin_learning_revision(uuid,uuid),public.read_learning_revision(uuid,uuid),public.record_learning_progress(uuid,uuid,uuid,text,integer,text),public.read_learning_progress(uuid,uuid,uuid,date,date),public.search_approved_knowledge(uuid,text,integer) to authenticated;
-- Historical workflow drafts remain readable; unfinished workflow requests cannot write.
drop policy workflow_insert on public.ai_workflows;
revoke insert(organization_id,requested_by,objective,mode,status) on public.ai_workflows from authenticated;
commit;
