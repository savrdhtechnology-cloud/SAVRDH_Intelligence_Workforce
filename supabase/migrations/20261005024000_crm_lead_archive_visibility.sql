-- Complete lead visibility and restrict legacy RPC privileges.
create or replace function public.sav_ai_crm_list_leads(p_status text default null, p_search text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, sav_ai_crm
as $$
declare wid uuid;
begin
  select workspace_id into wid from sav_ai_crm.members where user_id=auth.uid() and is_active=true order by created_at limit 1;
  if wid is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.created_at desc)
    from (
      select id,title,company,email,phone,source,status,priority,score,value,next_followup_at,created_at,metadata
      from sav_ai_crm.leads
      where workspace_id=wid
        and (p_status is null or p_status='' or status=p_status)
        and (p_search is null or p_search='' or title ilike '%'||p_search||'%' or company ilike '%'||p_search||'%' or email ilike '%'||p_search||'%' or phone ilike '%'||p_search||'%')
      order by created_at desc
    ) x
  ),'[]'::jsonb);
end;
$$;


