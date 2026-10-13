#!/usr/bin/env node
// Checks that a self-hosted model server (Ollama, vLLM, llama.cpp, LM Studio) is reachable
// and can return the structured JSON the SAV agents need. No paid API is used.
//
//   AI_BASE_URL=http://localhost:11434/v1 AI_MODEL=qwen2.5:7b-instruct npm run ai:check
//
// Exit code 0 = ready, 1 = not ready.

const baseUrl=(process.env.AI_BASE_URL||"http://localhost:11434/v1").trim().replace(/\/+$/,"");
const model=(process.env.AI_MODEL||"").trim();
const apiKey=(process.env.AI_API_KEY||"").trim();
const jsonMode=(process.env.AI_JSON_MODE||"json_schema").trim().toLowerCase();

if(!model){
  console.error("Set AI_MODEL, for example: AI_MODEL=qwen2.5:7b-instruct npm run ai:check");
  process.exit(1);
}

const schema={
  type:"object",
  additionalProperties:false,
  properties:{
    qualification:{type:"string",enum:["hot","warm","cold","unqualified"]},
    summary:{type:"string"},
    next_action:{type:"string"},
    follow_up_required:{type:"boolean"},
    confidence:{type:"number",minimum:0,maximum:1}
  },
  required:["qualification","summary","next_action","follow_up_required","confidence"]
};

const sampleLead={
  name:"Sample lead (test data)",
  city:"Bhopal",
  source:"website",
  message:"Hi, I run a used-car dealership with about 40 cars. I want a CRM with WhatsApp follow-ups. Can someone call me tomorrow?"
};

const body={
  model,
  temperature:0.2,
  stream:false,
  messages:[
    {role:"system",content:[
      "You are SAV-Sales, a sales executive. Qualify the lead using only the facts given.",
      "Reply with one JSON object only. No prose, no markdown.",
      "The JSON must match this JSON Schema exactly:",
      JSON.stringify(schema)
    ].join("\n")},
    {role:"user",content:JSON.stringify({lead:sampleLead})}
  ],
  response_format:jsonMode==="json_object"
    ? {type:"json_object"}
    : {type:"json_schema",json_schema:{name:"sav_sales_check",strict:true,schema}}
};

const started=Date.now();
let response;
try{
  response=await fetch(baseUrl+"/chat/completions",{
    method:"POST",
    headers:{"content-type":"application/json",...(apiKey?{authorization:"Bearer "+apiKey}:{})},
    body:JSON.stringify(body),
    signal:AbortSignal.timeout(Number(process.env.AI_TIMEOUT_MS)||180000)
  });
}catch(error){
  console.error(`✗ Could not reach ${baseUrl} — is the model server running? (${error.message})`);
  console.error("  Ollama: run `ollama serve` (or open the Ollama app), then `ollama pull "+model+"`.");
  process.exit(1);
}

const raw=await response.text();
if(!response.ok){
  console.error(`✗ HTTP ${response.status} from ${baseUrl}: ${raw.slice(0,400)}`);
  if(response.status===404) console.error("  The model may not be downloaded yet. Ollama: `ollama pull "+model+"`.");
  if(response.status===400&&jsonMode!=="json_object") console.error("  If your server does not support JSON-schema output, retry with AI_JSON_MODE=json_object.");
  process.exit(1);
}

const seconds=((Date.now()-started)/1000).toFixed(1);
let content=JSON.parse(raw)?.choices?.[0]?.message?.content||"";
content=content.replace(/<think>[\s\S]*?<\/think>/gi,"").trim();
const fenced=content.match(/```(?:json)?\s*([\s\S]*?)```/i);
if(fenced) content=fenced[1].trim();

let parsed;
try{ parsed=JSON.parse(content.slice(content.indexOf("{"),content.lastIndexOf("}")+1)); }
catch{
  console.error(`✗ Model answered in ${seconds}s but not with valid JSON:\n${content.slice(0,600)}`);
  console.error("  Try a larger or newer instruct model, or AI_JSON_MODE=json_object.");
  process.exit(1);
}

const missing=schema.required.filter((k)=>!(k in parsed));
const badQualification=!schema.properties.qualification.enum.includes(parsed.qualification);
console.log(`Model: ${model} @ ${baseUrl}`);
console.log(`Answer time: ${seconds}s`);
console.log(JSON.stringify(parsed,null,2));
if(missing.length||badQualification){
  console.error(`✗ JSON is missing or has invalid fields: ${[...missing,badQualification?"qualification":null].filter(Boolean).join(", ")}`);
  process.exit(1);
}
console.log("✓ Self-hosted model is ready for SAV agents.");
