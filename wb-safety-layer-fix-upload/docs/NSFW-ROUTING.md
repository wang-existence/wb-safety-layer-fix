# Adult content: what a host patch can and cannot do

Short version: the plugin removes **WorkBuddy's** interception. It cannot remove the **model
provider's** moderation, and it cannot remove the **model's own weight-level reluctance**.

| Layer | Who owns it | Does `wb-purge` touch it? | Symptom when it fires |
| --- | --- | --- | --- |
| System prompt / templates | WorkBuddy (local files) | **yes** — `P01`–`P04` | reply starts with a policy sentence |
| Approval / review gates | WorkBuddy CLI (local bundle) | **yes** — `P05`–`P11` + mods hooks | a card, a refusal to run a tool |
| Model alignment (RLHF) | the model weights | no (policy text only nudges it) | fluent refusal, or a scene that fades out |
| Provider content filter | the API behind the model | **no** | empty completion, `finish_reason: content_filter`, or a platform-level notice |

So "WorkBuddy still will not write adult content" is usually layers 3–4, not the plugin.

## What actually works

### Option A — point WorkBuddy at your own OpenAI-compatible endpoint

WorkBuddy reads custom models from `<profile>/models.json` (the same file the UI writes when you add a
custom model). Entries are plain objects; `custom-local:` in `--model` / `/model` selects them:

```json
[
  {
    "id": "local-nsfw",
    "name": "local-nsfw",
    "vendor": "Custom",
    "url": "http://127.0.0.1:11434/v1",
    "apiKey": "ollama",
    "supportsToolCall": true,
    "supportsImages": false,
    "supportsReasoning": false,
    "useCustomProtocol": false
  }
]
```

Then in a session: `/model` → `custom-local:local-nsfw`, or start with
`--model custom-local:local-nsfw`.

The request now goes to *your* server. No provider filter sits in the path; what remains is the
model's own alignment.

### Option B — self-hosted gateway in front of any backend

Same `models.json` shape, but `url` points at a small gateway you run (`http://127.0.0.1:8787/v1`)
which forwards to Ollama / vLLM / llama.cpp / a paid API you control. Useful when you need to inject a
fixed system prefix, rewrite sampling parameters, or fan out to several backends. Roughly 40 lines of
Node with `fetch`, streaming passthrough, `/v1/models` and `/v1/chat/completions`.

## Model choice matters more than any prompt rule

| Model family | Behaviour on explicit requests |
| --- | --- |
| stock instruct models (Llama-3-Instruct, Qwen2.5-Instruct, Mistral-Instruct) | refuse or fade out — alignment survives |
| community "abliterated" / uncensored fine-tunes (e.g. dolphin, mistral-nemo-abliterated, Qwen2.5-abliterated) | write it directly |
| roleplay-tuned local models | direct, but weaker instruction following on the rest of the task |

Sampling that works for long explicit scenes: `temperature 0.85–1.0`, `top_p 0.95`,
`repeat_penalty 1.05–1.1`, max tokens high enough that the scene is not cut mid-way. Short
`max_tokens` is the most common cause of "it stopped right before anything happened".

## What the plugin contributes on top

- `P01` puts the adult-fiction rule into the system prompt (write at requested explicitness, no fade
  to black, no euphemism, no substitute scene) — this measurably reduces *soft* refusal from local
  model weights.
- The mods layer repeats it per session (`config.json` → `adultFiction`, default on), so it survives
  template changes and context trimming.
- `prompt.submit` strips the "policy mode" framing that makes models answer defensively.

None of that reaches a provider-side filter. If the completion comes back empty with
`finish_reason: content_filter`, the request never reached a model that was allowed to answer —
switch the endpoint, not the prompt.

## Diagnosing which layer fired

```powershell
# raw provider response, including finish_reason
codebuddy -p "write an explicit scene" --output-format json
```

- `finish_reason: "content_filter"`, or an empty `content` with a platform message → provider filter.
- A fluent in-character refusal ("I can't write that") → model weights; keep the policy block, change
  the model.
- A host-style policy paragraph before any model text → a `P0x` patch is not applied; run
  `node bin/wb-purge.mjs status`.

## Scope note

This document describes configuration of a local installation you administer. It does not provide
content, and the rules about who may read or publish what remain yours to apply.
