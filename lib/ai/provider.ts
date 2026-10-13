import OpenAI from "openai";

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
// Self-hosted, OpenAI-compatible model servers (Ollama, vLLM, llama.cpp server, LM Studio).
// No per-token payment to an outside AI company: the model runs on Savrdh's own machine.
const LOCAL_PROVIDER_ALIASES=new Set(["local","ollama","vllm","llamacpp","lmstudio"]);

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

/* ------------------------------------------------------------------ */
/* Task specifications: one source of truth for prompts and schemas,   */
/* shared by every backend (OpenAI and self-hosted).                   */
/* ------------------------------------------------------------------ */

export type AITaskSpec={
  name:string;
  instructions:string;
  format:"text"|"json_object"|"json_schema";
  schema?:Record<string,unknown>;
};

export const AI_TASKS={
  generateResponse:{
    name:"crm_response",
    format:"text",
    instructions:"Respond to the CRM user request accurately. Do not perform external actions. Return text only."
  },
  classifyIntent:{
    name:"crm_intent",
    format:"json_schema",
    instructions:"Classify the CRM intent. Return the requested structured JSON only.",
    schema:{
      type:"object",
      additionalProperties:false,
      properties:{
        intent:{type:"string"},
        confidence:{type:"number",minimum:0,maximum:1}
      },
      required:["intent","confidence"]
    }
  },
  extractLeadData:{
    name:"crm_lead_facts",
    format:"json_object",
    instructions:"Extract only CRM lead facts explicitly present in the input. Return a JSON object and do not infer missing facts."
  },
  summarizeConversation:{
    name:"crm_conversation_summary",
    format:"text",
    instructions:"Summarize this CRM conversation factually. Do not perform or propose an external action unless the conversation explicitly asks for one."
  },
  planAction:{
    name:"sav_sales_agent_decision",
    format:"json_schema",
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
  },
  generateSalesEmail:{
    name:"sav_sales_email",
    format:"json_schema",
    instructions:[
      "Write a concise professional B2B sales email for Savrdh Technology.",
      "Use only facts present in the supplied lead and active product records.",
      "Do not invent customer needs, product capabilities, pricing, claims, or prior conversations.",
      "If personalization is weak, keep it factual and generic rather than guessing.",
      "Return structured JSON only."
    ].join("\n"),
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
  },
  evaluateConfidence:{
    name:"crm_confidence",
    format:"json_schema",
    instructions:"Evaluate confidence in the supplied CRM analysis based only on the supplied content. Return structured JSON.",
    schema:{
      type:"object",
      additionalProperties:false,
      properties:{confidence:{type:"number",minimum:0,maximum:1}},
      required:["confidence"]
    }
  }
} satisfies Record<string,AITaskSpec>;

/* ------------------------------------------------------------------ */
/* Fail-closed providers                                               */
/* ------------------------------------------------------------------ */

class UnconfiguredProvider implements AIProvider {
  constructor(protected readonly configuredProvider:string=OPENAI_PROVIDER){}
  private result<T>():AIProviderResult<T>{
    const local=LOCAL_PROVIDER_ALIASES.has(this.configuredProvider);
    const message=local
      ? "Self-hosted AI provider configuration requires AI_PROVIDER=local, AI_BASE_URL (for example http://localhost:11434/v1), and AI_MODEL in the server environment."
      : "OpenAI provider configuration requires AI_PROVIDER=openai, AI_API_KEY, and AI_MODEL in the server environment. For a self-hosted model use AI_PROVIDER=local, AI_BASE_URL and AI_MODEL.";
    return {
      ok:false,error:"AI_PROVIDER_NOT_CONFIGURED",message,
      diagnostic:{provider:this.configuredProvider,model:process.env.AI_MODEL?.trim()||null,http_status:null,code:"AI_PROVIDER_NOT_CONFIGURED",type:"configuration_error",request_id:null,message}
    };
  }
  generateResponse(){ return Promise.resolve(this.result<{text:string}>()); }
  classifyIntent(){ return Promise.resolve(this.result<{intent:string;confidence:number}>()); }
  extractLeadData(){ return Promise.resolve(this.result<Record<string,unknown>>()); }
  summarizeConversation(){ return Promise.resolve(this.result<{summary:string}>()); }
  planAction(){ return Promise.resolve(this.result<{action:string;payload:Record<string,unknown>;confidence:number}>()); }
  generateSalesEmail(){ return Promise.resolve(this.result<{subject:string;body:string;personalization_summary:string;confidence:number}>()); }
  evaluateConfidence(){ return Promise.resolve(this.result<{confidence:number}>()); }
}

class AdapterUnavailableProvider extends UnconfiguredProvider {
  constructor(configuredProvider:string){ super(configuredProvider); }
  private unavailable<T>():AIProviderResult<T>{
    const message=`Unsupported AI_PROVIDER "${this.configuredProvider}". This build supports AI_PROVIDER=openai or AI_PROVIDER=local (Ollama, vLLM, llama.cpp, LM Studio).`;
    return {
      ok:false,error:"AI_PROVIDER_ERROR",message,
      diagnostic:{provider:this.configuredProvider,model:process.env.AI_MODEL?.trim()||null,http_status:null,code:"UNSUPPORTED_PROVIDER",type:"configuration_error",request_id:null,message}
    };
  }
  generateResponse(){ return Promise.resolve(this.unavailable<{text:string}>()); }
  classifyIntent(){ return Promise.resolve(this.unavailable<{intent:string;confidence:number}>()); }
  extractLeadData(){ return Promise.resolve(this.unavailable<Record<string,unknown>>()); }
  summarizeConversation(){ return Promise.resolve(this.unavailable<{summary:string}>()); }
  planAction(){ return Promise.resolve(this.unavailable<{action:string;payload:Record<string,unknown>;confidence:number}>()); }
  generateSalesEmail(){ return Promise.resolve(this.unavailable<{subject:string;body:string;personalization_summary:string;confidence:number}>()); }
  evaluateConfidence(){ return Promise.resolve(this.unavailable<{confidence:number}>()); }
}

/* ------------------------------------------------------------------ */
/* Shared task runner: every backend only implements complete().       */
/* Parsing and normalisation are identical for all backends.           */
/* ------------------------------------------------------------------ */

abstract class TaskProvider implements AIProvider {
  protected abstract readonly providerName:string;
  protected abstract complete(task:AITaskSpec,input:string):Promise<string>;
  protected abstract error<T>(error:unknown):AIProviderResult<T>;

  private async run<T>(task:AITaskSpec,input:string,map:(text:string)=>T):Promise<AIProviderResult<T>>{
    try{
      const text=await this.complete(task,input);
      return {ok:true,data:map(text),provider:this.providerName};
    }catch(error){
      return this.error<T>(error);
    }
  }

  generateResponse(input:{prompt:string;context?:Record<string,unknown>}){
    return this.run(AI_TASKS.generateResponse,JSON.stringify({prompt:input.prompt,context:input.context||{}}),(text)=>({text}));
  }

  classifyIntent(input:{text:string}){
    return this.run(AI_TASKS.classifyIntent,input.text,(text)=>{
      const parsed=parseJsonObject(text);
      return {intent:String(parsed.intent||""),confidence:clampConfidence(parsed.confidence)};
    });
  }

  extractLeadData(input:{text:string}){
    return this.run(AI_TASKS.extractLeadData,input.text,(text)=>parseJsonObject(text));
  }

  summarizeConversation(input:{messages:Array<{role:string;content:string}>}){
    return this.run(AI_TASKS.summarizeConversation,JSON.stringify(input.messages),(text)=>({summary:text}));
  }

  planAction(input:{command:string;context?:Record<string,unknown>}){
    return this.run(AI_TASKS.planAction,JSON.stringify({command:input.command,context:input.context||{}}),(text)=>{
      const parsed=parseJsonObject(text);
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

      return {action:"sav_sales_decision",payload,confidence:clampConfidence(parsed.confidence)};
    });
  }

  generateSalesEmail(input:{lead:Record<string,unknown>;product:Record<string,unknown>;qualification:string;need:string}){
    return this.run(AI_TASKS.generateSalesEmail,JSON.stringify(input),(text)=>{
      const parsed=parseJsonObject(text);
      return {
        subject:String(parsed.subject||"").trim().slice(0,500),
        body:String(parsed.body||"").trim().slice(0,12000),
        personalization_summary:String(parsed.personalization_summary||"").trim().slice(0,1500),
        confidence:clampConfidence(parsed.confidence)
      };
    });
  }

  evaluateConfidence(input:{output:unknown}){
    return this.run(AI_TASKS.evaluateConfidence,JSON.stringify(input.output),(text)=>{
      const parsed=parseJsonObject(text);
      return {confidence:clampConfidence(parsed.confidence)};
    });
  }
}

/* ------------------------------------------------------------------ */
/* OpenAI backend (optional, paid)                                     */
/* ------------------------------------------------------------------ */

class OpenAIProvider extends TaskProvider {
  protected readonly providerName=OPENAI_PROVIDER;
  private readonly client:OpenAI;

  constructor(private readonly apiKey:string,private readonly model:string){
    super();
    this.client=new OpenAI({apiKey:this.apiKey});
  }

  protected async complete(task:AITaskSpec,input:string):Promise<string>{
    if(task.format==="json_schema"){
      const response=await this.client.responses.create({
        model:this.model,
        instructions:task.instructions,
        input,
        text:{format:{type:"json_schema",name:task.name,strict:true,schema:task.schema||{}}},
        store:false
      });
      return response.output_text;
    }
    if(task.format==="json_object"){
      const response=await this.client.responses.create({
        model:this.model,
        instructions:task.instructions,
        input,
        text:{format:{type:"json_object"}},
        store:false
      });
      return response.output_text;
    }
    const response=await this.client.responses.create({
      model:this.model,
      instructions:task.instructions,
      input,
      store:false
    });
    return response.output_text;
  }

  protected error<T>(error:unknown):AIProviderResult<T>{
    const value=(error&&typeof error==="object"?error:{}) as Record<string,unknown>;
    const nested=(value.error&&typeof value.error==="object"?value.error:{}) as Record<string,unknown>;
    const status=typeof value.status==="number"?value.status:null;
    const code=typeof value.code==="string"?value.code:(typeof nested.code==="string"?nested.code:null);
    const type=typeof value.type==="string"?value.type:(typeof nested.type==="string"?nested.type:null);
    const param=typeof value.param==="string"?value.param:(typeof nested.param==="string"?nested.param:null);
    const requestId=typeof value.request_id==="string"?value.request_id:(typeof value.requestID==="string"?value.requestID:null);
    const rawMessage=error instanceof Error?error.message:(typeof nested.message==="string"?nested.message:"OpenAI request failed");
    const message=rawMessage.replace(/sk-[A-Za-z0-9_-]+/g,"[REDACTED]");
    console.error("OpenAI Responses API error",{
      provider:OPENAI_PROVIDER,model:this.model,status,code,type,param,request_id:requestId,message
    });
    const detail=[status?("HTTP "+status):null,code,type].filter(Boolean).join(" · ");
    const publicMessage=detail?("OpenAI Responses API request failed ("+detail+")."):"OpenAI Responses API request failed.";
    return {
      ok:false,
      error:"AI_PROVIDER_ERROR",
      message:publicMessage,
      diagnostic:{provider:OPENAI_PROVIDER,model:this.model,http_status:status,code,type,request_id:requestId,message}
    };
  }
}

/* ------------------------------------------------------------------ */
/* Self-hosted backend: any OpenAI-compatible /chat/completions server  */
/* (Ollama, vLLM, llama.cpp server, LM Studio). Runs on our hardware.   */
/* ------------------------------------------------------------------ */

class LocalModelError extends Error {
  constructor(
    message:string,
    readonly status:number|null,
    readonly code:string,
    readonly type:string,
    readonly requestId:string|null=null
  ){ super(message); }
}

/** Removes reasoning blocks and code fences that small open models often add around JSON. */
export function cleanLocalModelText(raw:string,expectJson:boolean):string{
  let text=raw.replace(/<think>[\s\S]*?<\/think>/gi,"").trim();
  if(!expectJson) return text;
  const fenced=text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if(fenced) text=fenced[1].trim();
  if(!text.startsWith("{")){
    const start=text.indexOf("{");
    const end=text.lastIndexOf("}");
    if(start>=0&&end>start) text=text.slice(start,end+1);
  }
  return text;
}

type LocalModelConfig={
  providerName:string;
  baseUrl:string;
  model:string;
  apiKey:string|null;
  timeoutMs:number;
  temperature:number;
  jsonMode:"json_schema"|"json_object";
};

class LocalModelProvider extends TaskProvider {
  protected readonly providerName:string;

  constructor(private readonly config:LocalModelConfig){
    super();
    this.providerName=config.providerName;
  }

  private redact(text:string){
    let out=text;
    if(this.config.apiKey) out=out.split(this.config.apiKey).join("[REDACTED]");
    return out.replace(/sk-[A-Za-z0-9_-]+/g,"[REDACTED]");
  }

  protected async complete(task:AITaskSpec,input:string):Promise<string>{
    const expectJson=task.format!=="text";
    // Small open models follow the format far better when the schema is also in the prompt.
    const system=expectJson
      ? [
          task.instructions,
          "",
          "Reply with one JSON object only. No prose, no markdown, no code fences.",
          task.schema?("The JSON must match this JSON Schema exactly:\n"+JSON.stringify(task.schema)):""
        ].join("\n").trim()
      : task.instructions;

    const body:Record<string,unknown>={
      model:this.config.model,
      messages:[
        {role:"system",content:system},
        {role:"user",content:input}
      ],
      temperature:this.config.temperature,
      stream:false
    };
    if(task.format==="json_schema"&&this.config.jsonMode==="json_schema"){
      body.response_format={type:"json_schema",json_schema:{name:task.name,strict:true,schema:task.schema||{}}};
    }else if(expectJson){
      body.response_format={type:"json_object"};
    }

    const headers:Record<string,string>={"content-type":"application/json"};
    if(this.config.apiKey) headers.authorization="Bearer "+this.config.apiKey;

    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),this.config.timeoutMs);
    let response:Response;
    try{
      response=await fetch(this.config.baseUrl+"/chat/completions",{
        method:"POST",headers,body:JSON.stringify(body),signal:controller.signal,cache:"no-store"
      });
    }catch(error){
      if(controller.signal.aborted){
        throw new LocalModelError(`Self-hosted model did not answer within ${this.config.timeoutMs} ms.`,null,"TIMEOUT","timeout_error");
      }
      const reason=error instanceof Error?error.message:"network error";
      throw new LocalModelError(`Could not reach the self-hosted model server at ${this.config.baseUrl} (${reason}).`,null,"CONNECTION_FAILED","connection_error");
    }finally{
      clearTimeout(timer);
    }

    const requestId=response.headers.get("x-request-id");
    const raw=await response.text();
    let data:Record<string,unknown>={};
    try{ data=JSON.parse(raw) as Record<string,unknown>; }catch{ /* non-JSON error body */ }

    if(!response.ok){
      const nested=(data.error&&typeof data.error==="object"?data.error:{}) as Record<string,unknown>;
      const message=typeof nested.message==="string"?nested.message
        :typeof data.error==="string"?data.error
        :raw.slice(0,300)||response.statusText;
      const code=typeof nested.code==="string"?nested.code:"HTTP_"+response.status;
      const type=typeof nested.type==="string"?nested.type:"server_error";
      throw new LocalModelError(message,response.status,code,type,requestId);
    }

    const choices=Array.isArray(data.choices)?data.choices:[];
    const first=(choices[0]&&typeof choices[0]==="object"?choices[0]:{}) as Record<string,unknown>;
    const msg=(first.message&&typeof first.message==="object"?first.message:{}) as Record<string,unknown>;
    const content=typeof msg.content==="string"?msg.content:"";
    if(!content.trim()){
      throw new LocalModelError("Self-hosted model returned an empty answer.",response.status,"EMPTY_COMPLETION","response_error",requestId);
    }
    return cleanLocalModelText(content,expectJson);
  }

  protected error<T>(error:unknown):AIProviderResult<T>{
    const known=error instanceof LocalModelError?error:null;
    const status=known?known.status:null;
    const code=known?known.code:(error instanceof SyntaxError?"INVALID_JSON":"LOCAL_MODEL_ERROR");
    const type=known?known.type:(error instanceof SyntaxError?"response_error":"server_error");
    const requestId=known?known.requestId:null;
    const rawMessage=error instanceof Error?error.message:"Self-hosted model request failed";
    const message=this.redact(error instanceof SyntaxError?("Model did not return valid JSON: "+rawMessage):rawMessage);
    console.error("Self-hosted model error",{
      provider:this.providerName,model:this.config.model,status,code,type,request_id:requestId,message
    });
    const detail=[status?("HTTP "+status):null,code].filter(Boolean).join(" · ");
    return {
      ok:false,
      error:"AI_PROVIDER_ERROR",
      message:"Self-hosted model request failed"+(detail?(" ("+detail+")."):"."),
      diagnostic:{provider:this.providerName,model:this.config.model,http_status:status,code,type,request_id:requestId,message}
    };
  }
}

function numberEnv(name:string,fallback:number,min:number,max:number){
  const n=Number(process.env[name]);
  return Number.isFinite(n)&&n>=min&&n<=max?n:fallback;
}

export function getAIProvider():AIProvider {
  const provider=(process.env.AI_PROVIDER||"").trim().toLowerCase();
  const apiKey=(process.env.AI_API_KEY||"").trim();
  const model=(process.env.AI_MODEL||"").trim();

  if(LOCAL_PROVIDER_ALIASES.has(provider)){
    const baseUrl=(process.env.AI_BASE_URL||"").trim().replace(/\/+$/,"");
    if(!baseUrl||!model||!/^https?:\/\//i.test(baseUrl)) return new UnconfiguredProvider(provider);
    return new LocalModelProvider({
      providerName:provider,
      baseUrl,
      model,
      apiKey:apiKey||null,
      timeoutMs:numberEnv("AI_TIMEOUT_MS",120000,1000,600000),
      temperature:numberEnv("AI_TEMPERATURE",0.2,0,2),
      jsonMode:(process.env.AI_JSON_MODE||"").trim().toLowerCase()==="json_object"?"json_object":"json_schema"
    });
  }

  if(!provider||!apiKey||!model) return new UnconfiguredProvider(provider||OPENAI_PROVIDER);
  if(provider!==OPENAI_PROVIDER) return new AdapterUnavailableProvider(provider);
  return new OpenAIProvider(apiKey,model);
}
