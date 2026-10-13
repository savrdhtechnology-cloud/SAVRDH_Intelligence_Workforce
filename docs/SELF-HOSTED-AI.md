# Self-hosted AI (no paid AI API)

SAV agents can run on an open-weight model that Savrdh hosts itself. Nothing is sent to OpenAI or any other AI company and there is no per-message AI bill.

The app talks to any server that speaks the OpenAI-compatible `/v1/chat/completions` format:

| Server | Use it for |
|---|---|
| **Ollama** | Development on a Mac / single machine. Easiest. |
| **vLLM** | Production on a Linux GPU server. Fast, many users at once. |
| llama.cpp server, LM Studio | Also work. |

## 1. Run it on your Mac (development)

```bash
brew install ollama          # or download the app from ollama.com
ollama serve                 # skip if the Ollama app is already running
ollama pull qwen2.5:7b-instruct
```

`.env.local`:

```env
AI_PROVIDER=local
AI_BASE_URL=http://localhost:11434/v1
AI_MODEL=qwen2.5:7b-instruct
```

Check it before starting the app:

```bash
npm run ai:check
```

You should see a JSON lead qualification and `✓ Self-hosted model is ready for SAV agents.` Then `npm run dev` and use **Agents → Test** as usual.

The model name above is only an example. Any instruct model from Ollama's library works; newer Qwen, Gemma, Mistral or Llama releases may be better. Check each model's licence allows commercial use.

## 2. Choosing a model size

| Size | Good for | Memory needed (4-bit) |
|---|---|---|
| 3–4B | Intent detection, extracting name/phone/city | ~4 GB |
| 7–9B | SAV-Sales analysis, follow-up drafts (start here) | ~6–8 GB |
| 14B | Better Hindi/Hinglish and longer emails | ~10–12 GB |
| 32B | Best quality on one GPU | ~20–24 GB |

An Apple-Silicon Mac with 16 GB+ runs 7–14B comfortably for development.

## 3. Production

Vercel cannot run models. Put the model on a machine you control (office GPU box or a rented GPU server) and point the app at it:

```env
AI_PROVIDER=local
AI_BASE_URL=https://ai.internal.savrdhtechnologies.com/v1
AI_MODEL=<model name>
AI_API_KEY=<long random key>   # vLLM: start with --api-key <same key>
```

- Never expose the model server to the open internet without the key and HTTPS.
- `AI_BASE_URL` and `AI_API_KEY` are server-only. Never prefix them with `NEXT_PUBLIC_`.

## 4. Settings

| Variable | Default | Meaning |
|---|---|---|
| `AI_PROVIDER` | — | `local` (also accepts `ollama`, `vllm`, `llamacpp`, `lmstudio`) or `openai` |
| `AI_BASE_URL` | — | Required for local. Must end at `/v1`. |
| `AI_MODEL` | — | Required. Model name as the server knows it. |
| `AI_API_KEY` | empty | Optional for local; required for openai. |
| `AI_TIMEOUT_MS` | 120000 | Local models are slower than cloud APIs on small hardware. |
| `AI_TEMPERATURE` | 0.2 | Keep low for predictable business answers. |
| `AI_JSON_MODE` | `json_schema` | Use `json_object` if your server rejects JSON-schema output. |

## 5. How it fits the safety design

Nothing about the agent safety rules changes:

- The model only **proposes** actions as JSON; `lib/ai/crm-agent-tools.ts` validates and executes them with role, capability and approval checks.
- Every prompt and schema lives once in `AI_TASKS` in `lib/ai/provider.ts` and is used by both backends, so switching between local and OpenAI never changes agent behaviour rules.
- Errors are reported as `TIMEOUT`, `CONNECTION_FAILED`, `EMPTY_COMPLETION`, `INVALID_JSON` or the server's HTTP status, with keys redacted.
