begin;
-- Row-locking approved knowledge applies its UPDATE policy and hides it from editors.
-- Read the approved version under SELECT RLS; retain organization serialization and
-- the existing immutable approved-snapshot trigger. Publication permissions are unchanged.
create or replace function public.add_knowledge_to_learning_path(org_id uuid,course_id uuid,source_ids uuid[],request_id uuid) returns integer language plpgsql security invoker set search_path='' as $$
declare previous public.learning_path_source_batches; source_id uuid; k public.knowledge_items; batch uuid; next_position integer; target public.courses;
begin
 if (select auth.uid()) is null or coalesce(private.membership_role(org_id),'') not in('owner','admin','editor') then raise exception 'Author access required' using errcode='42501'; end if;
 if request_id is null or cardinality(source_ids) not between 1 and 50 or cardinality(source_ids)<>(select count(distinct x) from unnest(source_ids) x) or array_position(source_ids,null) is not null then raise exception 'Choose 1–50 different approved records' using errcode='22023'; end if;
 -- Serialize normal source edits and imports without requiring UPDATE access on approved knowledge.
 perform pg_advisory_xact_lock(hashtextextended(org_id::text,0));
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
  select * into k from public.knowledge_items x where x.id=source_id and x.organization_id=org_id and x.status='published';
  if not found then raise exception 'Every source must be approved and belong to this organization.' using errcode='42501'; end if;
  insert into public.lessons(organization_id,course_id,title,body,position,source_knowledge_id,source_version,source_batch_id) values(org_id,course_id,k.title,k.body,next_position,k.id,k.current_version,batch);
  next_position:=next_position+1;
 end loop;
 return cardinality(source_ids);
end; $$;
revoke all on function public.add_knowledge_to_learning_path(uuid,uuid,uuid[],uuid) from public,anon;
grant execute on function public.add_knowledge_to_learning_path(uuid,uuid,uuid[],uuid) to authenticated;
commit;
