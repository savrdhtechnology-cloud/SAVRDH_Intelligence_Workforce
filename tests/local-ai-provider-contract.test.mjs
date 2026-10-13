import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const provider=readFileSync(new URL("../lib/ai/provider.ts",import.meta.url),"utf8");
const envExample=readFileSync(new URL("../.env.example",import.meta.url),"utf8");
const check=readFileSync(new URL("../scripts/check-local-ai.mjs",import.meta.url),"utf8");

test("self-hosted provider is selectable and environment-driven",()=>{
  assert.match(provider,/class LocalModelProvider extends TaskProvider/);
  assert.match(provider,/LOCAL_PROVIDER_ALIASES=new Set\(\["local","ollama","vllm","llamacpp","lmstudio"\]\)/);
  assert.match(provider,/process\.env\.AI_BASE_URL/);
  assert.match(provider,/\/chat\/completions/);
  assert.match(envExample,/AI_PROVIDER=local/);
  assert.match(envExample,/AI_BASE_URL=/);
});

test("self-hosted provider fails closed without base URL or model",()=>{
  assert.match(provider,/if\(!baseUrl\|\|!model\|\|!\/\^https\?:\\\/\\\/\/i\.test\(baseUrl\)\) return new UnconfiguredProvider\(provider\)/);
});

test("both backends share one set of prompts, schemas and parsing",()=>{
  assert.match(provider,/export const AI_TASKS=/);
  assert.match(provider,/class OpenAIProvider extends TaskProvider/);
  assert.equal((provider.match(/name:"sav_sales_agent_decision"/g)||[]).length,1);
  assert.equal((provider.match(/external_action_performed:false/g)||[]).length,1);
});

test("self-hosted errors are classified and secrets are redacted",()=>{
  for(const code of ["TIMEOUT","CONNECTION_FAILED","EMPTY_COMPLETION","INVALID_JSON"]) assert.match(provider,new RegExp(code));
  assert.match(provider,/split\(this\.config\.apiKey\)\.join\("\[REDACTED\]"\)/);
  assert.doesNotMatch(provider,/NEXT_PUBLIC_.*AI_BASE_URL/);
});

test("local readiness check uses no paid API and no dependencies",()=>{
  assert.doesNotMatch(check,/from "openai"|require\("openai"\)/);
  assert.match(check,/\/chat\/completions/);
});
