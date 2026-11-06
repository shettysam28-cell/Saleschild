-- READ ONLY. These are conservative candidates, not approved cleanup targets.
-- No tenant/record identifiers or source content are returned. Tenant numbers
-- identify groups within this result only and are not stable identifiers.
with labels(label) as (
 values ('topic'),('category'),('subtopic'),('learning objective'),('knowledge content'),
 ('process steps'),('example scenario'),('correct response'),('common mistakes'),
 ('assessment question'),('answer options'),('correct answer'),('difficulty'),
 ('source reference'),('effective date'),('last reviewed'),('content owner')
), candidates as (
 select k.organization_id,k.id,k.status,
 exists(select 1 from public.lessons l where l.organization_id=k.organization_id and l.source_knowledge_id=k.id)
 or exists(select 1 from public.learning_revision_units u where u.organization_id=k.organization_id and u.source_knowledge_id=k.id) as learning_linked
 from public.knowledge_items k
 cross join lateral (
  select count(*) as nonempty, bool_and(lower(btrim(f->>'value')) in(select label from labels)) as all_labels
  from jsonb_array_elements(case when jsonb_typeof(k.custom_fields)='array' then k.custom_fields else '[]'::jsonb end) f
  where btrim(coalesce(f->>'value',''))<>''
 ) fields
 where k.discarded_at is null and lower(btrim(k.title)) in(select label from labels)
 and fields.nonempty>=2 and fields.all_labels
), grouped as (
 select organization_id,count(*) as candidate_count,
 count(*) filter(where status='published') as published_candidates,
 count(*) filter(where learning_linked) as learning_linked_candidates
 from candidates group by organization_id
), numbered as (
 select row_number() over(order by organization_id) as tenant_group,
 candidate_count,published_candidates,learning_linked_candidates from grouped
)
select coalesce(sum(candidate_count),0) as candidate_count,
 coalesce(jsonb_agg(jsonb_build_object('tenant_group',tenant_group,'candidate_count',candidate_count,'published_candidates',published_candidates,'learning_linked_candidates',learning_linked_candidates) order by tenant_group),'[]'::jsonb) as tenant_groups
from numbered;
