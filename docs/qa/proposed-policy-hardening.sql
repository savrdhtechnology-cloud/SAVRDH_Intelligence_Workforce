-- NOT APPLIED: automatic approval review rejected broad permission and execution-policy changes. Requires review before use.
-- Authenticated RPC facade remains membership-scoped. Remove inherited anonymous execution.
do $$ declare f record; begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname like 'sav_ai_crm_%' and has_function_privilege('anon',p.oid,'EXECUTE')
 loop
  execute format('revoke execute on function %s from public, anon',f.signature);
  execute format('grant execute on function %s to authenticated',f.signature);
 end loop;
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='sav_ai_crm' and p.proconfig is null
 loop execute format('alter function %s set search_path = public, sav_ai_crm',f.signature);end loop;
end $$;

-- Serialize and enforce configured hours and daily execution limits at the database boundary.
create or replace function sav_ai_crm.enforce_agent_execution_policy()
returns trigger language plpgsql security definer set search_path=public,sav_ai_crm as $$
declare a sav_ai_crm.ai_agents; local_now timestamp; tz text; used int; maximum int;
begin
 if new.input->>'mode'='analyze' then return new;end if;
 select * into a from sav_ai_crm.ai_agents where id=new.agent_id for update;
 if a.id is null or a.status<>'active' then raise exception 'Agent is not active';end if;
 tz:=coalesce(a.working_hours->>'timezone','UTC');
 local_now:=now() at time zone tz;
 if a.working_hours <> '{}'::jsonb then
  if jsonb_typeof(a.working_hours->'days')<>'array' or a.working_hours->>'start' is null or a.working_hours->>'end' is null then raise exception 'Agent working hours are incomplete';end if;
  if not (a.working_hours->'days' @> jsonb_build_array(extract(isodow from local_now)::int)) then raise exception 'Agent is outside configured working days';end if;
  if (a.working_hours->>'start')::time >= (a.working_hours->>'end')::time then raise exception 'Agent working hours require start before end';end if;
  if local_now::time < (a.working_hours->>'start')::time or local_now::time >= (a.working_hours->>'end')::time then raise exception 'Agent is outside configured working hours';end if;
 end if;
 if a.daily_limits ? 'executions' then
  maximum:=(a.daily_limits->>'executions')::int;
  select count(*) into used from sav_ai_crm.ai_agent_executions e where e.agent_id=a.id and coalesce(e.input->>'mode','execute')<>'analyze' and (e.created_at at time zone tz)::date=local_now::date;
  if maximum<0 or used>=maximum then raise exception 'Agent daily execution limit reached';end if;
 end if;
 return new;
end $$;
drop trigger if exists crm_agent_execution_policy on sav_ai_crm.ai_agent_executions;
create trigger crm_agent_execution_policy before insert on sav_ai_crm.ai_agent_executions for each row execute function sav_ai_crm.enforce_agent_execution_policy();
revoke all on function sav_ai_crm.enforce_agent_execution_policy() from public,anon,authenticated;
