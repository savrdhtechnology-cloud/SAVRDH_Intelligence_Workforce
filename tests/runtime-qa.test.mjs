import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module,{createRequire} from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url);
// Compile the actual application modules, not replicas of their implementation.
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,filename);
const {deterministicPlan,deterministicSalesEmail}=require('../lib/ai/deterministic.ts');
const {getAIProvider}=require('../lib/ai/provider.ts');
const {analyzeSalesLead,executeSalesDecision}=require('../lib/ai/agent-engine.ts');
const {withApiErrors}=require('../lib/ai/api-errors.ts');
const {sendSalesEmail}=require('../lib/email/send.ts');
const leadId='11111111-1111-4111-8111-111111111111',agentId='22222222-2222-4222-8222-222222222222';
const context={lead:{id:leadId,title:'QA Example',email:'qa@example.invalid'}};
const original={...process.env};
function env(vars){for(const k of ['AI_PROVIDER','AI_API_KEY','AI_MODEL','EMAIL_PROVIDER','EMAIL_API_KEY','EMAIL_FROM'])delete process.env[k];Object.assign(process.env,vars);}
test.after(()=>{for(const k of Object.keys(process.env))if(!(k in original))delete process.env[k];Object.assign(process.env,original);});

test('deterministic plan parses explicit createTask without performing any action',()=>{
 const plan=deterministicPlan('create task: Call customer',context);assert.equal(plan.payload.proposed_actions[0].tool,'createTask');assert.equal(plan.payload.proposed_actions[0].title,'Call customer');assert.equal(plan.payload.external_action_performed,false);
});
test('unknown requests and financial actions produce qualification only, never invented product/status',()=>{
 for(const command of ['approve loan and mark won','send email now','find a product']){const p=deterministicPlan(command,context);assert.equal(p.payload.recommended_product,null);assert.equal(p.payload.proposed_actions[0].tool,'createTask');assert.equal(p.confidence,0);}
});
test('disabled and deterministic modes keep CRM planning and template drafts available',async()=>{
 for(const mode of ['disabled','deterministic']){env({AI_PROVIDER:mode});const provider=getAIProvider();const p=await provider.planAction({command:'create task: Follow up',context});assert.equal(p.ok,true);assert.equal(p.provider,'deterministic');const reasoning=await provider.generateResponse({prompt:'Research this company'});assert.equal(reasoning.ok,false);assert.match(reasoning.message,/CRM operations remain available/);}
});
test('unconfigured OpenAI falls back to deterministic operations',async()=>{
 env({AI_PROVIDER:'openai'});assert.equal((await getAIProvider().planAction({command:'create follow-up: Call',context})).provider,'deterministic');
});
test('analyze reads database and returns a plan with zero mutation RPCs',async()=>{
 env({AI_PROVIDER:'disabled'});const calls=[];const db={rpc:async(name)=>{calls.push(name);if(name==='sav_ai_crm_lead_sales_detail')return {data:{lead:context.lead},error:null};if(name==='sav_ai_crm_active_products')return {data:[],error:null};throw new Error('Unexpected write '+name);}};
 const result=await analyzeSalesLead({supabase:db,agentId,leadId,command:'create task: Review'});assert.equal(result.ok,true);assert.deepEqual(result.data.actions_taken,[]);assert.deepEqual(calls,['sav_ai_crm_lead_sales_detail','sav_ai_crm_active_products']);
});
test('database failure returns an explicit failure, not empty successful analysis',async()=>{
 const result=await analyzeSalesLead({supabase:{rpc:async()=>({data:null,error:{message:'database offline'}})},agentId,leadId,command:'create task: Review'});assert.equal(result.ok,false);assert.equal(result.error,'LEAD_READ_FAILED');
});
test('execute rejects malformed plans and wrong lead IDs before any mutation',async()=>{
 const calls=[];const db={rpc:async(n)=>{calls.push(n);return {data:{lead:context.lead},error:null};}};
 const result=await executeSalesDecision({supabase:db,agentId,leadId,decision:{lead_id:'different'}});assert.equal(result.ok,false);assert.equal(result.error,'INVALID_AGENT_PLAN');assert.deepEqual(calls,['sav_ai_crm_lead_sales_detail']);
});
function actionDb({approval=false,role='owner',dbFailure=false}={}){const calls=[];return {calls,rpc:async(n)=>{calls.push(n);if(n==='sav_ai_crm_lead_sales_detail')return {data:{lead:context.lead}};if(n==='sav_ai_crm_workspace')return {data:{role}};if(n==='sav_ai_crm_agent_detail')return {data:{capabilities:[{capability:'CREATE_TASK',is_enabled:true}]}};if(n==='sav_ai_crm_request_agent_action')return {data:{action_id:'action-id',approval_required:approval}};if(n==='sav_ai_crm_execute_agent_action')return dbFailure?{error:{message:'Database update failed'}}:{data:{status:'completed',task_id:'task-id'}};if(n==='sav_ai_crm_log_agent_tool')return {error:null};throw new Error(n);}};}
const decision={lead_id:leadId,qualification:'cold',confidence:1,proposed_actions:[{tool:'createTask',payload:{title:'Review'}}]};
test('deterministic execution persists task and log without provider access',async()=>{
 env({AI_PROVIDER:'disabled'});const db=actionDb();const r=await executeSalesDecision({supabase:db,agentId,leadId,decision});assert.equal(r.data.actions_taken[0].task_id,'task-id');assert.equal(r.data.errors.length,0);assert.ok(db.calls.includes('sav_ai_crm_log_agent_tool'));
});
test('approval-required action is queued and never executes automatically',async()=>{
 const db=actionDb({approval:true});const r=await executeSalesDecision({supabase:db,agentId,leadId,decision});assert.equal(r.data.approval_required,true);assert.ok(!db.calls.includes('sav_ai_crm_execute_agent_action'));
});
test('viewer and failed writes produce failed tool results',async()=>{
 for(const opts of [{role:'viewer'},{dbFailure:true}]){const r=await executeSalesDecision({supabase:actionDb(opts),agentId,leadId,decision});assert.equal(r.data.actions_taken[0].ok,false);assert.equal(r.data.errors.length,1);}
});
test('template email uses only known fields and rejects missing product',()=>{
 const r=deterministicSalesEmail({lead:{title:'QA Example'},product:{name:'Approved Product',description:'Verified description'}});assert.match(r.body,/Verified description/);assert.doesNotMatch(r.body,/₹|discount|researched/);assert.throws(()=>deterministicSalesEmail({lead:{},product:{}}));
});
test('email send fails closed without configuration and never calls provider',async()=>{
 env({});let called=false;const r=await sendSalesEmail({id:leadId,recipient:'qa@example.invalid',subject:'QA',body:'Test'},async()=>{called=true;});assert.equal(r.ok,false);assert.equal(called,false);
});
test('email acceptance requires provider ID and uses stable idempotency key',async()=>{
 env({EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'test-only',EMAIL_FROM:'qa@example.invalid'});const calls=[];const send=async(url,init)=>{calls.push(init.headers['Idempotency-Key']);return Response.json({id:'provider-123'});};
 const r=await sendSalesEmail({id:leadId,recipient:'qa@example.invalid',subject:'QA',body:'Test'},send);assert.equal(r.ok,true);assert.equal(r.status,'SENT');assert.equal(calls[0],`sav-sales-${leadId}`);
 const missing=await sendSalesEmail({id:leadId,recipient:'qa@example.invalid',subject:'QA',body:'Test'},async()=>Response.json({}));assert.equal(missing.ok,false);assert.equal(missing.uncertain,true);
});
test('provider rejection and timeout never become sent or leak provider secrets',async()=>{
 env({EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'secret-test-value',EMAIL_FROM:'qa@example.invalid'});const input={id:leadId,recipient:'qa@example.invalid',subject:'QA',body:'Test'};
 const rejected=await sendSalesEmail(input,async()=>Response.json({message:'secret-test-value'},{status:401}));assert.equal(rejected.ok,false);assert.equal(rejected.httpStatus,401);assert.doesNotMatch(JSON.stringify(rejected),/secret-test-value/);
 const uncertain=await sendSalesEmail(input,async()=>{throw new Error('Timeout');});assert.equal(uncertain.ok,false);assert.equal(uncertain.uncertain,true);
});
test('API boundary safely distinguishes missing database, invalid fields and unconfirmed failure',async()=>{
 for(const [e,status] of [[new Error('Supabase environment is not configured'),503],[new SyntaxError('bad JSON'),422],[new Error('secret-internal-token'),503]]){const r=await withApiErrors(async()=>{throw e;})(new Request('https://example.invalid'));assert.equal(r.status,status);assert.doesNotMatch(await r.text(),/secret-internal-token/);}
});
test('OpenAI failure captures safe diagnostics and never reports provider success',async()=>{
 env({AI_PROVIDER:'openai',AI_API_KEY:'sk-test-sensitive',AI_MODEL:'test-model'});const prev=global.fetch;global.fetch=async()=>Response.json({error:{message:'key sk-test-sensitive expired',code:'invalid_api_key',type:'invalid_request_error'}},{status:401,headers:{'x-request-id':'qa-request'}});
 try{const result=await getAIProvider().generateResponse({prompt:'QA'});assert.equal(result.ok,false);assert.equal(result.diagnostic.http_status,401);assert.equal(result.diagnostic.code,'invalid_api_key');assert.equal(result.diagnostic.model,'test-model');assert.doesNotMatch(JSON.stringify(result),/sk-test-sensitive/);}finally{global.fetch=prev;}
});
