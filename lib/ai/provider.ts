import OpenAI from "openai";
import { deterministicPlan, deterministicSalesEmail } from "./deterministic";

export type AIProviderDiagnostic={
  provider:string;
  model:string|null;
  http_status:number|null;
  code:string|null;
  type:string|null;
  request_id:string|null;
  message:string;
};

export type AIProviderResult<T> =
  | { ok:true; data:T; provider:string }
  | {
      ok:false;
      error:"AI_PROVIDER_NOT_CONFIGURED"|"AI_PROVIDER_ERROR";
      message:string;
      diagnostic:AIProviderDiagnostic;
    };

export interface AIProvider {
  generateResponse(input:{prompt:string;context?:Record<string,unknown>}):Promise<AIProviderResult<{text:string}>>;
  classifyIntent(input:{text:string}):Promise<AIProviderResult<{intent:string;confidence:number}>>;
  extractLeadData(input:{text:string}):Promise<AIProviderResult<Record<string,unknown>>>;
  summarizeConversation(input:{messages:Array<{role:string;content:string}>}):Promise<AIProviderResult<{summary:string}>>;
  planAction(input:{command:string;context?:Record<string,unknown>}):Promise<AIProviderResult<{action:string;payload:Record<string,unknown>;confidence:number}>>;
  generateSalesEmail(input:{lead:Record<string,unknown>;product:Record<string,unknown>;qualification:string;need:string}):Promise<AIProviderResult<{subject:string;body:string;personalization_summary:string;confidence:number}>>;
  evaluateConfidence(input:{output:unknown}):Promise<AIProviderResult<{confidence:number}>>;
}

const OPENAI_PROVIDER="openai";

function clampConfidence(value:unknown){
  const n=typeof value==="number"?value:Number(value);
  if(!Number.isFinite(n)) return 0;
  return Math.max(0,Math.min(1,n));
}

function parseJsonObject(text:string):Record<string,unknown>{
  const parsed=JSON.parse(text) as unknown;
  if(!parsed||typeof parsed!=="object"||Array.isArray(parsed)) throw new Error("Expected an object response");
  return parsed as Record<string,unknown>;
}

class UnconfiguredProvider implements AIProvider {
  private result<T>():AIProviderResult<T>{
    const message="AI provider unavailable. This reasoning feature requires a configured provider. Deterministic CRM operations remain available.";
    return {
      ok:false,error:"AI_PROVIDER_NOT_CONFIGURED",message,
      diagnostic:{provider:OPENAI_PROVIDER,model:process.env.AI_MODEL?.trim()||null,http_status:null,code:"AI_PROVIDER_NOT_CONFIGURED",type:"configuration_error",request_id:null,message}
    };
  }
  generateResponse(){ return Promise.resolve(this.result<{text:string}>()); }
  classifyIntent(){ return Promise.resolve(this.result<{intent:string;confidence:number}>()); }
  extractLeadData(){ return Promise.resolve(this.result<Record<string,unknown>>()); }
  summarizeConversation(){ return Promise.resolve(this.result<{summary:string}>()); }
  planAction(_input?:{command:string;context?:Record<string,unknown>}){ return Promise.resolve(this.result<{action:string;payload:Record<string,unknown>;confidence:number}>()); }
  generateSalesEmail(_input?:{lead:Record<string,unknown>;product:Record<string,unknown>;qualification:string;need:string}){ return Promise.resolve(this.result<{subject:string;body:string;personalization_summary:string;confidence:number}>()); }
  evaluateConfidence(){ return Promise.resolve(this.result<{confidence:number}>()); }
}

class AdapterUnavailableProvider extends UnconfiguredProvider {
  constructor(private readonly configuredProvider:string){ super(); }
  private unavailable<T>():AIProviderResult<T>{
    const message=`Unsupported AI_PROVIDER "${this.configuredProvider}". Supported modes: openai, deterministic, disabled.`;
    return {
      ok:false,error:"AI_PROVIDER_ERROR",message,
      diagnostic:{provider:this.configuredProvider,model:process.env.AI_MODEL?.trim()||null,http_status:null,code:"UNSUPPORTED_PROVIDER",type:"configuration_error",request_id:null,message}
    };
  }
  generateResponse(){ return Promise.resolve(this.unavailable<{text:string}>()); }
  classifyIntent(){ return Promise.resolve(this.unavailable<{intent:string;confidence:number}>()); }
  extractLeadData(){ return Promise.resolve(this.unavailable<Record<string,unknown>>()); }
  summarizeConversation(){ return Promise.resolve(this.unavailable<{summary:string}>()); }
  planAction(_input?:{command:string;context?:Record<string,unknown>}){ return Promise.resolve(this.unavailable<{action:string;payload:Record<string,unknown>;confidence:number}>()); }
  generateSalesEmail(_input?:{lead:Record<string,unknown>;product:Record<string,unknown>;qualification:string;need:string}){ return Promise.resolve(this.unavailable<{subject:string;body:string;personalization_summary:string;confidence:number}>()); }
  evaluateConfidence(){ return Promise.resolve(this.unavailable<{confidence:number}>()); }
}

class OpenAIProvider implements AIProvider {
  private readonly client:OpenAI;

  constructor(private readonly apiKey:string,private readonly model:string){
    this.client=new OpenAI({apiKey:this.apiKey,timeout:20000,maxRetries:0});
  }

  private error<T>(error:unknown):AIProviderResult<T>{
    const value=(error&&typeof error==="object"?error:{}) as Record<string,unknown>;
    const nested=(value.error&&typeof value.error==="object"?value.error:{}) as Record<string,unknown>;
    const status=typeof value.status==="number"?value.status:null;
    const code=typeof value.code==="string"?value.code:(typeof nested.code==="string"?nested.code:null);
    const type=typeof value.type==="string"?value.type:(typeof nested.type==="string"?nested.type:null);
    const param=typeof value.param==="string"?value.param:(typeof nested.param==="string"?nested.param:null);
    const requestId=typeof value.request_id==="string"?value.request_id:(typeof value.requestID==="string"?value.requestID:null);
    const rawMessage=error instanceof Error?error.message:(typeof nested.message==="string"?nested.message:"OpenAI request failed");
    const message=rawMessage.split(this.apiKey).join("[REDACTED]").replace(/(?:sk-|Bearer )[A-Za-z0-9_.-]+/g,"[REDACTED]").slice(0,500);
    console.error("OpenAI Responses API error",{
      provider:OPENAI_PROVIDER,model:this.model,status,code,type,param,request_id:requestId,message
    });
    const detail=[status?("HTTP "+status):null,code,type].filter(Boolean).join(" · ");
    const publicMessage=detail?("OpenAI Responses API request failed ("+detail+")."):"OpenAI Responses API request failed.";
    return {
      ok:false,
      error:"AI_PROVIDER_ERROR",
      message:publicMessage,
      diagnostic:{
        provider:OPENAI_PROVIDER,
        model:this.model,
        http_status:status,
        code,
        type,
        request_id:requestId,
        message
      }
    };
  }

  async generateResponse(input:{prompt:string;context?:Record<string,unknown>}):Promise<AIProviderResult<{text:string}>>{
    try{
      const response=await this.client.responses.create({
        model:this.model,
        instructions:"Respond to the CRM user request accurately. Do not perform external actions. Return text only.",
        input:JSON.stringify({prompt:input.prompt,context:input.context||{}}),
        store:false
      });
      return {ok:true,data:{text:response.output_text},provider:OPENAI_PROVIDER};
    }catch(error){
      return this.error<{text:string}>(error);
    }
  }

  async classifyIntent(input:{text:string}):Promise<AIProviderResult<{intent:string;confidence:number}>>{
    try{
      const response=await this.client.responses.create({
        model:this.model,
        instructions:"Classify the CRM intent. Return the requested structured JSON only.",
        input:input.text,
        text:{format:{
          type:"json_schema",
          name:"crm_intent",
          strict:true,
          schema:{
            type:"object",
            additionalProperties:false,
            properties:{
              intent:{type:"string"},
              confidence:{type:"number",minimum:0,maximum:1}
            },
            required:["intent","confidence"]
          }
        }},
        store:false
      });
      const parsed=parseJsonObject(response.output_text);
      return {ok:true,data:{intent:String(parsed.intent||""),confidence:clampConfidence(parsed.confidence)},provider:OPENAI_PROVIDER};
    }catch(error){
      return this.error<{intent:string;confidence:number}>(error);
    }
  }

  async extractLeadData(input:{text:string}):Promise<AIProviderResult<Record<string,unknown>>>{
    try{
      const response=await this.client.responses.create({
        model:this.model,
        instructions:"Extract only CRM lead facts explicitly present in the input. Return a JSON object and do not infer missing facts.",
        input:input.text,
        text:{format:{type:"json_object"}},
        store:false
      });
      return {ok:true,data:parseJsonObject(response.output_text),provider:OPENAI_PROVIDER};
    }catch(error){
      return this.error<Record<string,unknown>>(error);
    }
  }

  async summarizeConversation(input:{messages:Array<{role:string;content:string}>}):Promise<AIProviderResult<{summary:string}>>{
    try{
      const response=await this.client.responses.create({
        model:this.model,
        instructions:"Summarize this CRM conversation factually. Do not perform or propose an external action unless the conversation explicitly asks for one.",
        input:JSON.stringify(input.messages),
        store:false
      });
      return {ok:true,data:{summary:response.output_text},provider:OPENAI_PROVIDER};
    }catch(error){
      return this.error<{summary:string}>(error);
    }
  }

  async planAction(input:{command:string;context?:Record<string,unknown>}):Promise<AIProviderResult<{action:string;payload:Record<string,unknown>;confidence:number}>>{
    try{
      const response=await this.client.responses.create({
        model:this.model,
        instructions:[
          "You are SAV-Sales, the Sales & Telecalling Executive inside SAVRDH AI Workforce.",
          "Analyze only CRM data and knowledge explicitly provided in the request.",
          "Never invent customer facts, product catalog entries, financial facts, approvals, or application status.",
          "Only recommend a product whose exact name appears in context.active_products. If no supported active product fits, set recommended_product to null.",
          "ANALYZE mode is read-only: propose actions but do not claim they were performed.",
          "EXECUTION is performed later by deterministic CRM tools, not by the model.",
          "Never propose marking a lead won, approving payments, changing financial records, deleting data, sending external messages, or bypassing approval.",
          "Allowed proposed tools are updateLeadStatus, createTask, createFollowup, requestApproval.",
          "For updateLeadStatus, allowed statuses are new, contacted, qualified, proposal, negotiation, nurture.",
          "Return the exact structured JSON schema requested."
        ].join("\n"),
        input:JSON.stringify({command:input.command,context:input.context||{}}),
        text:{format:{
          type:"json_schema",
          name:"sav_sales_agent_decision",
          strict:true,
          schema:{
            type:"object",
            additionalProperties:false,
            properties:{
              qualification:{type:"string",enum:["hot","warm","cold","unqualified"]},
              summary:{type:"string"},
              recommended_product:{type:["string","null"]},
              next_action:{type:"string"},
              follow_up_required:{type:"boolean"},
              proposed_actions:{
                type:"array",
                maxItems:5,
                items:{
                  type:"object",
                  additionalProperties:false,
                  properties:{
                    tool:{type:"string",enum:["updateLeadStatus","createTask","createFollowup","requestApproval"]},
                    status:{type:["string","null"]},
                    title:{type:["string","null"]},
                    description:{type:["string","null"]},
                    priority:{type:["string","null"]},
                    due_at:{type:["string","null"]},
                    reminder_at:{type:["string","null"]},
                    followup_type:{type:["string","null"]},
                    capability:{type:["string","null"]}
                  },
                  required:["tool","status","title","description","priority","due_at","reminder_at","followup_type","capability"]
                }
              },
              confidence:{type:"number",minimum:0,maximum:1}
            },
            required:[
              "qualification","summary","recommended_product","next_action",
              "follow_up_required","proposed_actions","confidence"
            ]
          }
        }},
        store:false
      });

      const parsed=parseJsonObject(response.output_text);
      const rawActions=Array.isArray(parsed.proposed_actions)?parsed.proposed_actions:[];
      const proposedActions=rawActions
        .filter((value)=>value&&typeof value==="object"&&!Array.isArray(value))
        .map((value)=>value as Record<string,unknown>);

      const payload:Record<string,unknown>={
        qualification:String(parsed.qualification||"cold"),
        summary:String(parsed.summary||""),
        recommended_product:typeof parsed.recommended_product==="string"?parsed.recommended_product:null,
        next_action:String(parsed.next_action||""),
        follow_up_required:parsed.follow_up_required===true,
        proposed_actions:proposedActions,
        external_action_performed:false
      };

      return {
        ok:true,
        data:{
          action:"sav_sales_decision",
          payload,
          confidence:clampConfidence(parsed.confidence)
        },
        provider:OPENAI_PROVIDER
      };
    }catch(error){
      return this.error<{action:string;payload:Record<string,unknown>;confidence:number}>(error);
    }
  }

  async generateSalesEmail(input:{lead:Record<string,unknown>;product:Record<string,unknown>;qualification:string;need:string}):Promise<AIProviderResult<{subject:string;body:string;personalization_summary:string;confidence:number}>>{
    try{
      const response=await this.client.responses.create({
        model:this.model,
        instructions:[
          "Write a concise professional B2B sales email for Savrdh Technology.",
          "Use only facts present in the supplied lead and active product records.",
          "Do not invent customer needs, product capabilities, pricing, claims, or prior conversations.",
          "If personalization is weak, keep it factual and generic rather than guessing.",
          "Return structured JSON only."
        ].join("\n"),
        input:JSON.stringify(input),
        text:{format:{
          type:"json_schema",
          name:"sav_sales_email",
          strict:true,
          schema:{
            type:"object",
            additionalProperties:false,
            properties:{
              subject:{type:"string"},
              body:{type:"string"},
              personalization_summary:{type:"string"},
              confidence:{type:"number",minimum:0,maximum:1}
            },
            required:["subject","body","personalization_summary","confidence"]
          }
        }},
        store:false
      });
      const parsed=parseJsonObject(response.output_text);
      return {ok:true,data:{
        subject:String(parsed.subject||"").trim().slice(0,500),
        body:String(parsed.body||"").trim().slice(0,12000),
        personalization_summary:String(parsed.personalization_summary||"").trim().slice(0,1500),
        confidence:clampConfidence(parsed.confidence)
      },provider:OPENAI_PROVIDER};
    }catch(error){
      return this.error<{subject:string;body:string;personalization_summary:string;confidence:number}>(error);
    }
  }

  async evaluateConfidence(input:{output:unknown}):Promise<AIProviderResult<{confidence:number}>>{
    try{
      const response=await this.client.responses.create({
        model:this.model,
        instructions:"Evaluate confidence in the supplied CRM analysis based only on the supplied content. Return structured JSON.",
        input:JSON.stringify(input.output),
        text:{format:{
          type:"json_schema",
          name:"crm_confidence",
          strict:true,
          schema:{
            type:"object",
            additionalProperties:false,
            properties:{confidence:{type:"number",minimum:0,maximum:1}},
            required:["confidence"]
          }
        }},
        store:false
      });
      const parsed=parseJsonObject(response.output_text);
      return {ok:true,data:{confidence:clampConfidence(parsed.confidence)},provider:OPENAI_PROVIDER};
    }catch(error){
      return this.error<{confidence:number}>(error);
    }
  }
}

class DeterministicProvider extends UnconfiguredProvider {
  async planAction(input:{command:string;context?:Record<string,unknown>}):Promise<AIProviderResult<{action:string;payload:Record<string,unknown>;confidence:number}>>{
    return {ok:true,data:deterministicPlan(input.command,input.context),provider:"deterministic"};
  }
  async generateSalesEmail(input:{lead:Record<string,unknown>;product:Record<string,unknown>;qualification:string;need:string}):Promise<AIProviderResult<{subject:string;body:string;personalization_summary:string;confidence:number}>>{
    return {ok:true,data:deterministicSalesEmail(input),provider:"deterministic"};
  }
}

export function getAIProvider():AIProvider {
  const provider=(process.env.AI_PROVIDER||"deterministic").trim().toLowerCase();
  const apiKey=(process.env.AI_API_KEY||"").trim();
  const model=(process.env.AI_MODEL||"").trim();
  if(provider==="deterministic"||provider==="disabled") return new DeterministicProvider();
  if(provider!==OPENAI_PROVIDER) return new AdapterUnavailableProvider(provider);
  if(!apiKey||!model) return new DeterministicProvider();
  return new OpenAIProvider(apiKey,model);
}
