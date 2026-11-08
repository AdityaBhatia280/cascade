# 11 — Practical Nemotron Integration (Cascade agent)

**Scope:** Nemotron model lineup, hosted and local serving, tool-calling quirks, agent frameworks, reliability practices, latency and cost, for Cascade's tool-using agent (NVIDIA track undecided). **Researched:** 2026-11-07.

This was written for an earlier incident-response version of the agent; the tool names in the sketch (§7) reflect that design. Cascade's shipped agent (model builder and redundancy fixer, OpenAI-compatible client, default Nemotron) is described in the repo README. Evaluation methodology is in `12-prior-work-and-evaluation.md`.
Every claim carries a source URL that was read during this research. Items marked **[UNVERIFIED]** were not confirmed against an official source; items marked **[INFERENCE]** are my reasoning, not something a source states.

---

## 1. Summary

- **The lineup is bigger than "Nemotron 3".** As of November 2026 the official Hugging Face collection holds Nemotron 3 (Nano 4B, Nano 30B-A3B, Super 120B-A12B, Ultra 550B-A55B) and a newer **Nemotron 3.5** wave (Lightning 30B-A3B, Aug 2026; Bolt 74B-A9B, Oct 2026; Super-VL 120B-A12B). All are hybrid Mamba-2/MoE/attention models with a reasoning on/off switch.
- **Recommended agent model: `nvidia/nemotron-3-super-120b-a12b` on the hosted NVIDIA API** (`https://integrate.api.nvidia.com/v1`, OpenAI-compatible). It is the model whose hosted ID, reasoning switches and `tool_choice` behaviour are most fully documented. **Nemotron 3.5 Lightning** is the speed alternative (about 670 tok/s measured by Artificial Analysis, scores near Super on their index). Keep the model ID in config and A/B test both in the first hour.
- **Hosting plan:** hosted NVIDIA API first. Fallback 1 is the same model on OpenRouter (same OpenAI SDK, different base URL). Fallback 2 is local vLLM on an RTX PRO 6000 Blackwell (96 GB) serving Lightning NVFP4 or Nano FP8. Fallback 3 is a recorded-trace replay so the demo never depends on the network.
- **Free hosted tier:** no credits any more. It is a rate-limited trial, commonly 40 requests/minute, and the limit varies by model and load. One agent run of about 11 LLM calls fits, but several concurrent demo runs could hit the limit.
- **Tool calling works through standard OpenAI `tools`/`tool_calls`.** When self-hosting you must pass `--tool-call-parser qwen3_coder` plus the Nemotron reasoning parser. Without them the model *describes* tool calls in its reasoning text and never emits them (a documented gotcha).
- **Frameworks:** **NeMo Agent Toolkit is deprecated (Oct 2026, end of life by end of 2026)**, so do not build on it. NeMo Guardrails' tool-call rails run only on an opt-in, *experimental* engine. Recommendation: a plain ~150-line tool loop of your own, with Pydantic validation, a hard step cap, an approval gate, and a JSONL audit log.
- **Cost is negligible.** About 11 calls and ~70k input + ~10k output tokens per run comes to about $0.01 at OpenRouter's Super prices, and $0 on the build.nvidia.com trial. Latency is about 20–60 s per run with thinking off or low, and 1–3 min with full thinking **[INFERENCE]**.

---

## 2. Model table (official sources)

| Model (HF repo / hosted ID) | Total / active params | Context | Released | Agentic / tool-use notes | Reasoning control | License | Source |
|---|---|---|---|---|---|---|---|
| **Nemotron 3 Nano 30B-A3B** (`nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-{BF16,FP8,NVFP4}`; build page `nvidia/nemotron-3-nano-30b-a3b`) | 30B / ~3.5B | 256k default, up to 1M | Dec 15 2025 | BFCL v4 53.8 (BF16) / 53.2 (FP8); TauBench V2 avg 49.0 / 47.0. Tool-call sampling: temp 0.6, top_p 0.95. The build page lists structured output as **not supported** | `chat_template_kwargs.enable_thinking` (default on); client-side `reasoning_budget` | NVIDIA Nemotron Open Model License | [HF FP8 card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-FP8), [build page](https://build.nvidia.com/nvidia/nemotron-3-nano-30b-a3b), [family page](https://research.nvidia.com/labs/nemotron/Nemotron-3) |
| **Nemotron 3 Nano 4B** (`nvidia/NVIDIA-Nemotron-3-Nano-4B-{BF16,FP8,GGUF}`) | 4B | not checked | Mar 2026 (HF dates) | Edge model; not evaluated here | — | — | [HF collection](https://huggingface.co/collections/nvidia/nvidia-nemotron-v3) |
| **Nemotron 3 Super 120B-A12B** (`nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-{BF16,FP8,NVFP4}`; **hosted ID `nvidia/nemotron-3-super-120b-a12b`**) | 120B / 12B (LatentMoE + MTP) | up to 1M (vLLM/SGLang default 256k) | Mar 11 2026 | Tau-Bench V2 avg 61.15 (BF16) / 61.07 (FP8) / 60.46 (NVFP4); Terminal Bench hard ~26. NIM supports `tool_choice: "required"` and named tools | `enable_thinking` true/false; `low_effort: true`; `reasoning_budget` (NIM request field); `force_nonempty_content` for agents. Sampling: temp 1.0, top_p 0.95 for everything | NVIDIA Nemotron Open Model License | [HF FP8 card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-FP8), [build page](https://build.nvidia.com/nvidia/nemotron-3-super-120b-a12b), [NIM 1.15 release notes](https://docs.nvidia.com/nim/large-language-models/1.15.0/release-notes.html) |
| **Nemotron 3 Ultra 550B-A55B** (`nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B-{BF16,NVFP4}`) | 550B / 55B | not checked | HF updates Aug 2026 | Largest; impractical locally | not checked | not checked | [HF collection](https://huggingface.co/collections/nvidia/nvidia-nemotron-v3), [Ultra blog](https://research.nvidia.com/labs/nemotron/Nemotron-3-Ultra/) (linked, not read) |
| **Nemotron 3.5 Lightning 30B-A3B** (`nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-{BF16,NVFP4}`; build path `nvidia/nemotron-3.5-lightning-30b-a3b`; OpenRouter `nvidia/nemotron-3.5-lightning:free`) | 30B / 3B, MTP + DFlash/DSpark drafters | up to 1M (single H100 validated at 256k) | Aug 11 2026 | Distilled from Ultra for agent "execution" (tool calls, routine steps). The build page lists function calling **and** structured output as supported. AA Intelligence Index 24 (Super 26, Nano 15). NVIDIA PinchBench 86%. tau3-Banking 9.28 (Super 12.37) | `enable_thinking` true/false only (no low-effort or budget documented) | **OpenMDW-1.1** | [HF BF16 card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16), [HF NVFP4 card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4), [NVIDIA blog](https://developer.nvidia.com/blog/nvidia-nemotron-3-5-lightning-delivers-fast-accurate-specialized-task-execution-for-long-running-agents/), [build page](https://build.nvidia.com/nvidia/nemotron-3.5-lightning-30b-a3b), [Artificial Analysis](https://artificialanalysis.ai/articles/nemotron-3-5-lightning-launch) |
| **Nemotron 3.5 Bolt 74B-A9B** (`nvidia/NVIDIA-Nemotron-3.5-Bolt-74B-A9B-{BF16,24GB,24GB-GGUF}`) | 74B / 9B, multimodal (text/image/video) | 256k | Oct 15 2026 | MCP-Atlas 55.6, Terminal-Bench 2.1 53.9, tau3-Banking 17.0. The **24GB** variant is native 2-bit and targets <24 GB at batch 1 / 128k | `enable_thinking`; `medium_effort: true` | OpenMDW-1.1 | [HF BF16 card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Bolt-74B-A9B-BF16) |
| **Nemotron 3.5 Super-VL 120B-A12B** (`nvidia/NVIDIA-Nemotron-3.5-Super-VL-120B-A12B-{BF16,NVFP4}`) | 120B / 12B, vision | not checked | ~Oct 2026 | NIM lists a 2× RTX PRO 6000 Blackwell NVFP4 profile. Known issue: forced tool choice invents args for zero-param tools | `enable_thinking`; `reasoning_effort` low/medium/high; **do not** use `thinking_token_budget` (empties `content`) | not checked | [NIM get-started](https://docs.nvidia.com/nim/large-language-models/2.0.13/get-started/advanced/get-started-nemotron-3.5-super-vl.html), [NVIDIA blog](https://developer.nvidia.com/blog/nvidia-nemotron-3-5-super-vl-powers-specialized-agents-with-multimodal-reasoning/) (not read) |

Notes:
- Benchmarks are vendor-reported, from different harnesses and benchmark versions (tau2 vs tau3), so don't compare across rows.
- The two licenses differ: Nemotron 3 uses the NVIDIA Nemotron Open Model License ([text](https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-nemotron-open-model-license/)) and 3.5 uses OpenMDW-1.1 ([text](https://openmdw.ai/license/1-1/)). Both say "ready for commercial use". Neither matters for a hackathon demo.
- Hosted-API ID for Lightning: the build.nvidia.com page leaves `model` blank in its snippets. The blog gives the path `nvidia/nemotron-3.5-lightning-30b-a3b`. **[UNVERIFIED] whether that exact string is accepted as `model=`.** Confirm it on day 1 with a `GET /v1/models`.

---

## 3. How to call the models

### 3.1 Hosted NVIDIA API catalog (build.nvidia.com)
- **Base URL:** `https://integrate.api.nvidia.com/v1`. It is OpenAI-compatible, so the official `openai` Python SDK works unchanged. ([Super build page](https://build.nvidia.com/nvidia/nemotron-3-super-120b-a12b))
- **Auth:** `api_key=os.environ["NVIDIA_API_KEY"]` in the official example ([same page](https://build.nvidia.com/nvidia/nemotron-3-super-120b-a12b)). Keys are created at build.nvidia.com and use an `nvapi-` prefix ([third-party guide](https://pasqualepillitteri.it/en/news/1621/nvidia-build-free-api-100-ai-models-2026), **[UNVERIFIED vs official doc]**).
- **Model ID (verified):** `nvidia/nemotron-3-super-120b-a12b`.
- **Reasoning switches** go through `extra_body={"chat_template_kwargs": {...}}`:
  - `{"enable_thinking": False}` turns reasoning off.
  - `{"enable_thinking": True, "low_effort": True}` gives short reasoning (Super).
  - When reasoning is on, the trace comes back in `message.reasoning_content` ([Lightning build page](https://build.nvidia.com/nvidia/nemotron-3.5-lightning-30b-a3b)).
- **Free tier / limits:** NVIDIA forum moderators say the credit system was removed and the catalog is a "trial experience". Users commonly report a default of **40 RPM**, which "will vary per model queried and may vary based on the number of concurrent users". There is no official way to raise it on the free tier ([forum: credits](https://forums.developer.nvidia.com/t/cannot-find-the-amount-of-credits-left-on-nim-api/337051), [forum: 40→200 RPM request](https://forums.developer.nvidia.com/t/request-for-nvidia-nim-api-rate-limit-increase-40-200-rpm/375340)). Your actual limit appears in the account menu on build.nvidia.com. Terms: NVIDIA API Trial Terms of Service.
- **Hackathon note [INFERENCE]:** HackUTD NVIDIA tracks have sometimes handed out credits or keys. Ask the NVIDIA sponsor table on day 1; this is not verified for 2026.

### 3.2 Tool / function calling format and quirks
- **Request shape:** standard OpenAI `tools=[{"type":"function","function":{name, description, parameters(JSON Schema)}}]` with `tool_choice` set to `"auto"`, `"none"`, or a named function. You return results as `{"role":"tool","tool_call_id":..., "content":...}` ([NIM function-calling docs 1.14](https://docs.nvidia.com/nim/large-language-models/1.14.0/function-calling.html)).
- **`tool_choice: "required"`:** the docs conflict. NIM general known issues say `required` is no longer supported. The Nemotron-3-Super NIM entry says it *is* supported ([NIM 1.15 release notes](https://docs.nvidia.com/nim/large-language-models/1.15.0/release-notes.html)). → **Use `"auto"`, and enforce "must call a tool" in your own loop.**
- **Forced tool choice on zero-parameter tools** can produce invented argument keys. Use `auto` for those tools (documented for 3.5 Super-VL; [NIM get-started](https://docs.nvidia.com/nim/large-language-models/2.0.13/get-started/advanced/get-started-nemotron-3.5-super-vl.html)). → Give every tool at least one real parameter, e.g. `incident_id`.
- **Past bugs (fixed in the NIM variant):** double-serialized JSON tool arguments, and empty `content` when streaming ([NIM 1.15 release notes](https://docs.nvidia.com/nim/large-language-models/1.15.0/release-notes.html)). → **Defensively `json.loads` the arguments a second time if the first parse yields a `str`.**
- **Nano NIM:** the release notes say "Tool calling may occasionally fail" ([same](https://docs.nvidia.com/nim/large-language-models/1.15.0/release-notes.html)).
- **Parallel tool calls:** NIM deprecated the `parallel_tool_calls` flag in favour of per-model support ([search summary of NIM 1.10 notes](https://docs.nvidia.com/nim/large-language-models/1.10.0/release-notes.html)). **[UNVERIFIED]** whether Super emits several `tool_calls` in one turn on the hosted API. → Handle a list anyway, and execute the calls sequentially.
- **Unparsed tool call:** if `tool_calls` is empty but the call text appears in `content`, the parser didn't catch it. The NIM docs say to fix the chat template or parser ([NIM 1.14](https://docs.nvidia.com/nim/large-language-models/1.14.0/function-calling.html)). → Count this as a retryable error in the loop.
- **Reasoning eats the token budget.** The reasoning block comes before the tool call, so a low `max_tokens` truncates before any call is emitted. A community report recommends ≥512 for tool prompts and ≥4096 for complex ones ([gotcha write-up](https://kenrollins.github.io/gemma-forge/journal/gotchas/nemotron-tool-parser/)). Bolt's card states that reasoning and answer share `max_tokens` ([Bolt card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Bolt-74B-A9B-BF16)).

### 3.3 Structured JSON output
- **Lightning:** the build page lists structured output as supported ([build page](https://build.nvidia.com/nvidia/nemotron-3.5-lightning-30b-a3b)). OpenRouter lists `response_format` for both Lightning and Super ([OR Lightning](https://openrouter.ai/nvidia/nemotron-3.5-lightning), [OR Super](https://openrouter.ai/nvidia/nemotron-3-super-120b-a12b)).
- **Nano:** the build page lists structured output as **not supported** ([build page](https://build.nvidia.com/nvidia/nemotron-3-nano-30b-a3b)).
- **NIM 2.x:** `response_format: {"type":"json_object"}` guarantees valid JSON but not a particular shape. Use `{"type":"json_schema", ...}` with `required` fields ([NIM 3.5 Super-VL page](https://docs.nvidia.com/nim/large-language-models/2.0.13/get-started/advanced/get-started-nemotron-3.5-super-vl.html)).
- **Older NIM/vLLM:** `guided_json`. Also: "Function calling and structured generation is not supported for pipeline parallelism greater than 1" ([NIM 1.15 notes](https://docs.nvidia.com/nim/large-language-models/1.15.0/release-notes.html)).
- **Recommendation:** **don't depend on server-side schema enforcement.** Get structure from tool arguments (validated by Pydantic), and make the final report a `submit_report` tool call. The report is then just another validated tool call.

### 3.4 Streaming
- `stream=True` works on the OpenAI-compatible endpoint (the build pages expose a `stream` parameter). Streaming tool-call deltas are not documented in the NIM function-calling page; all of its examples use `stream=False` ([NIM 1.14](https://docs.nvidia.com/nim/large-language-models/1.14.0/function-calling.html)).
- **Recommendation:** non-streaming for tool turns. Stream progress to the UI with your own SSE events (one per tool call and result). Optionally stream `reasoning_content` for the final narrative only.

### 3.5 Self-hosting
**Required server flags** (vLLM), from the model cards:
- `--enable-auto-tool-choice --tool-call-parser qwen3_coder` (all Nemotron 3 / 3.5 models)
- Reasoning parser, which varies by model card:
  - Super: `--reasoning-parser nemotron_v3` (vLLM 0.18.1 command) ([Super card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-FP8))
  - Nano: `--reasoning-parser-plugin nano_v3_reasoning_parser.py --reasoning-parser nano_v3` ([Nano card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-FP8))
  - Lightning: `--reasoning-parser nemotron_v3` ([Lightning NVFP4 card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4))
  - Bolt: `--reasoning-parser-plugin ultra_v3_reasoning_parser.py --reasoning-parser ultra_v3` ([Bolt card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Bolt-74B-A9B-BF16))
  - SGLang uses `--reasoning-parser nemotron_3`, TRT-LLM uses `--reasoning_parser nano-v3` / `nemotron-v3`, and the tool parser is `qwen3_coder` on all of them.
- **Behaviour to know about:** vLLM's `NemotronV3Parser` swaps reasoning and content when `enable_thinking=False` or `force_nonempty_content=True` and content is empty ([vLLM API doc](https://docs.vllm.ai/en/latest/api/vllm/parser/nemotron_v3/)).
- **NIM containers:** e.g. `nvcr.io/nim/nvidia/nemotron-3.5-super-vl-120b-a12b:2.0.13-variant-build.1`, run with `--gpus=all`, `NIM_MODEL_PROFILE=<id>`, port 8000.
  - "Each profile runs only on the GPU model and GPU count it lists; there is no generic fallback profile."
  - Tool calling is pre-enabled in model-specific NIMs ([NIM 3.5 Super-VL](https://docs.nvidia.com/nim/large-language-models/2.0.13/get-started/advanced/get-started-nemotron-3.5-super-vl.html), [NIM 1.14 function calling](https://docs.nvidia.com/nim/large-language-models/1.14.0/function-calling.html)).
  - Nano NIM on RTX PRO 6000 Blackwell: "if the server hangs during deployment, add `-e NCCL_P2P_DISABLE=1`" ([NIM 1.15 notes](https://docs.nvidia.com/nim/large-language-models/1.15.0/release-notes.html)).

**What fits on which RTX 6000:**

| GPU | Recommended local model | Evidence | Confidence |
|---|---|---|---|
| **RTX PRO 6000 Blackwell 96 GB** | **Lightning 30B-A3B NVFP4** (checkpoint ~22 GB after QAD) or **Nano 30B-A3B FP8** | Lightning NVFP4 lists Blackwell support; QAD shrank it 66→22 GB ([QAD blog](https://developer.nvidia.com/blog/developing-nemotron-3-5-lightning-nvfp4-with-qad-using-nvidia-model-optimizer/) search snippet). Nano card lists "RTX PRO 6000 96GB" among tested hardware ([Nano card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-FP8)) | High for Nano; medium for Lightning (no RTX PRO 6000 recipe published) |
| RTX PRO 6000 Blackwell 96 GB | Super 120B NVFP4 (~67B params in the metadata) | Card minimum is "1× B200 OR 1× DGX Spark"; RTX PRO 6000 not mentioned ([Super NVFP4 card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-NVFP4)). The 3.5 Super-VL NIM uses **2×** RTX PRO 6000 | **[UNVERIFIED]** on 1 card; plausible on 2 cards. Not worth hackathon time |
| **RTX 6000 Ada 48 GB** | Lightning **W4A16** (~22 GB) or Nano FP8 (~32B params at 1 byte ≈ 32 GB + KV) at reduced `--max-model-len` (e.g. 32k–64k) | Ada isn't listed on any card. NVFP4 needs Blackwell; W4A16 covers Ampere ([Lightning NVFP4 card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4)). Ollama guidance on that card: "24-48GB -> 32K, 48GB+ -> 256K" | **[UNVERIFIED]**. Ada (sm_89) has FP8 and the W4A16 Marlin path should work [INFERENCE]. Test before relying on it |
| Either | Bolt 74B-A9B-24GB (2-bit) / GGUF via llama.cpp | "native 2-bit quantization to fit in 24GB" ([Bolt card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Bolt-74B-A9B-BF16)) | Medium. Bolt's vLLM recipe uses `--max-num-seqs 1` and a parser plugin |

Example local command (Nano FP8, from the official card, with context trimmed for 48 GB **[INFERENCE]**):
```bash
pip install -U "vllm>=0.12.0"
wget https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-FP8/resolve/main/nano_v3_reasoning_parser.py
vllm serve nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-FP8 --served-model-name model \
  --max-num-seqs 8 --tensor-parallel-size 1 --max-model-len 65536 --port 8000 \
  --trust-remote-code --enable-auto-tool-choice --tool-call-parser qwen3_coder \
  --reasoning-parser-plugin nano_v3_reasoning_parser.py --reasoning-parser nano_v3 --kv-cache-dtype fp8
```
(The card sets `VLLM_USE_FLASHINFER_MOE_FP8=1` for Blackwell. Drop it on Ada.)

### 3.6 Third-party hosted fallback (OpenRouter)
- Same OpenAI SDK with `base_url="https://openrouter.ai/api/v1"` **[base URL not re-verified in this session; standard OpenRouter value]**.
- Super pricing: about $0.075–0.08 input / $0.40–0.45 output per 1M tokens (DeepInfra / DekaLLM); some providers charge more ($0.30/$2.40) ([OR Super](https://openrouter.ai/nvidia/nemotron-3-super-120b-a12b)).
- Lightning: $0.025–0.07 in / $0.12–0.20 out ([OR Lightning](https://openrouter.ai/nvidia/nemotron-3.5-lightning)). A `:free` Lightning listing exists ([NVIDIA blog](https://developer.nvidia.com/blog/nvidia-nemotron-3-5-lightning-delivers-fast-accurate-specialized-task-execution-for-long-running-agents/)).
- Both list `tools`, `tool_choice`, `response_format`, `reasoning`.
- Judging risk: the NVIDIA criterion is "Nemotron performs real multi-step tool workflows". The model is still Nemotron, so OpenRouter should qualify, but say so explicitly in the demo.

---

## 4. Framework assessment

| Option | What it is (verified) | Help for a 36 h build | Risk | Verdict |
|---|---|---|---|---|
| **NeMo Agent Toolkit** (formerly AgentIQ/AIQ) | v1.9. YAML workflow config, profiling, observability/tracing, eval, MCP, HITL middleware, NIM/OpenAI providers ([docs](https://docs.nvidia.com/nemo/agent-toolkit/latest/index.html)) | Free tracing and HITL hooks | **"deprecated as of October 2026 and will reach end of life (EOL) by end of year 2026."** Successors: NeMo Helix (CLI for eval/optimization/hardening) and NeMo Fabric (agent harness runtime) ([migration guide](https://docs.nvidia.com/nemo/agent-toolkit/latest/resources/migration-guide.html)). Learning curve plus a framework judges know is EOL | **Skip** |
| **NeMo Fabric / NeMo Helix** | Named successors ([migration guide](https://docs.nvidia.com/nemo/agent-toolkit/latest/resources/migration-guide.html); repos github.com/NVIDIA/NeMo-Fabric, github.com/NVIDIA-NeMo/nemo-helix) | Unknown | New, docs not evaluated **[UNVERIFIED maturity]** | Skip for the build. Optionally mention as "future work" |
| **NeMo Guardrails** (0.24.x) | Tool-call validation (name allowlist + JSON-Schema args) and tool-result validation that fail closed ([tool-calling rails doc](https://docs.nvidia.com/nemo/guardrails/configure-guardrails/guardrail-catalog/tool-calling)) | Exactly the checks we need | Runs only on the **IORails engine, "opt-in and experimental"**. A typo in a flow name *silently* falls back and disables the rails unless `require_iorails=True` ([same doc](https://docs.nvidia.com/nemo/guardrails/configure-guardrails/guardrail-catalog/tool-calling)) | **Skip.** Get the same guarantees from ~20 lines of Pydantic + allowlist. Optional stretch: wrap the loop with Guardrails for an "NVIDIA stack" talking point |
| **NeMo Switchyard** | Router: planning to frontier models, execution to Lightning ([Lightning blog](https://developer.nvidia.com/blog/nvidia-nemotron-3-5-lightning-delivers-fast-accurate-specialized-task-execution-for-long-running-agents/)) | Not needed with one model | Extra moving part | Skip |
| **Plain OpenAI-SDK tool loop** | — | Full control, easy to log, replay and gate | You write ~150 lines | **Use this** |

---

## 5. Reliability practices for the tool-using agent

1. **Allowlist + schema validation.**
   - One Pydantic model per tool. The JSON Schema in `tools=` is generated from it (`Model.model_json_schema()`).
   - Reject unknown tool names and invalid args. Return the validation error *to the model* as the tool result (`{"error": "...", "retryable": true}`) so it can self-correct. Cap at 2 corrections per step.
   - Same idea as Guardrails' fail-closed tool rails, minus the framework ([Guardrails doc](https://docs.nvidia.com/nemo/guardrails/configure-guardrails/guardrail-catalog/tool-calling)).
2. **Defensive argument parsing.** If `json.loads(args)` returns a `str`, parse it again (double-serialization bug, [NIM 1.15](https://docs.nvidia.com/nim/large-language-models/1.15.0/release-notes.html)). If `tool_calls` is empty but `content` contains `<tool_call>` or `<function=`, treat it as a parser miss and retry once with `enable_thinking: False`.
3. **Hard limits.**
   - `MAX_STEPS = 16` LLM turns per incident (the plan needs about 10).
   - `MAX_TOOL_CALLS_PER_TURN = 4`; a per-tool call budget (e.g. `optimize_recovery` ≤ 3) to stop loops.
   - A wall-clock timeout per incident.
   - Detect repeated identical calls (same name + args hash) and inject "you already have this result as E7".
4. **Retries.**
   - HTTP 429/5xx: `OpenAI(max_retries=3, timeout=60)` gives exponential backoff for free.
   - After repeated failures, switch provider (NVIDIA → OpenRouter → local) through an ordered client list.
   - Never retry `execute_simulated_action` blindly: make it idempotent with an `action_id` key.
5. **Human approval gate (in code, not in the prompt).**
   - Tools are labelled `READ` (get_*, forecast, optimize, verify) or `CONSEQUENTIAL` (`create_work_order`, `execute_simulated_action`).
   - When the model calls a consequential tool, the loop **does not execute it**. It persists a `PendingApproval{plan_id, args, evidence_ids}`, emits an SSE event to the right-hand panel, and suspends.
   - On approve, the loop runs the deterministic feasibility check, then executes and feeds the result back. On reject, it feeds back `{"status":"rejected","reason":...}`, which forces replanning.
   - `execute_simulated_action` must reference a `plan_id` produced by `optimize_recovery`. Free-form actions are rejected.
6. **Evidence citation.**
   - Every tool result is stored with an ID (`E1`, `E2`, …) and returned to the model as `{"evidence_id":"E4", "data":{...}}`.
   - System-prompt rule: *"Every number or claim in your report must cite one or more evidence IDs like [E4]. Do not state numbers that do not appear in evidence."*
   - The final report is a `submit_report` tool call with `claims: [{text, evidence_ids[]}]`. Code checks that every ID exists, and (cheaply) that numbers in `text` appear in the cited payloads. On failure, send the error back once.
   - This directly satisfies "Model-generated explanations must cite observed evidence".
7. **Audit log + deterministic replay.**
   - Append-only JSONL per incident. One row per event: `llm_request` (messages hash, model, params), `llm_response` (raw message incl. `reasoning_content`, usage, latency), `tool_call`, `tool_result`, `approval`, `error`.
   - Tools are deterministic, so a run can be replayed by feeding the logged LLM responses back (cassette mode, `AGENT_MODE=replay`).
   - Use replay for the live demo if the network fails, and for regression tests on each scenario type. Temperature-1.0 sampling isn't reproducible, so the cassette *is* the determinism.
   - Also log `seed` if the provider honours it (OpenRouter lists `seed` as accepted; [OR](https://openrouter.ai/nvidia/nemotron-3-super-120b-a12b)).
8. **Reasoning settings.**
   - Tool turns: `enable_thinking: False`, or Super's `low_effort: True`. This cuts latency and avoids the "tool call lost inside reasoning" failure.
   - `max_tokens ≥ 2048` when thinking is on ([gotcha](https://kenrollins.github.io/gemma-forge/journal/gotchas/nemotron-tool-parser/)).
   - Optionally enable full thinking only for the "compare options" turn.
   - Sampling: NVIDIA recommends temp 1.0 / top_p 0.95 for Super and Lightning ([Super card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-FP8)) and temp 0.6 / top_p 0.95 for Nano tool calls ([Nano card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-FP8)). Keep the defaults; reliability comes from validation, not low temperature.
9. **Evaluate like NVIDIA does.** NVIDIA's Sept 2026 agent-eval blog ([link](https://developer.nvidia.com/blog/how-to-evaluate-ai-agents-from-tool-calls-to-task-completion/)) recommends:
   - Score step-level (tool precision, argument accuracy) *and* end-to-end via environment state.
   - Run 3–5 trials and report a range.
   - Track steps-per-success and cost-per-success.
   - Watch for contamination, e.g. "agents retrieving answer keys": keep any answer key out of every tool's reachable paths. (In Cascade that file is `seed/sites/dfw1/ground_truth.json`, which per the README only tests read.)
   - Put a small table (success rate over 5 runs × each scenario type, avg steps, avg latency) on the demo slide.
10. **Documented Nemotron-specific failure modes:**
    - (a) Missing or incorrect parsers mean the model describes tool calls in prose and never emits them ([gotcha](https://kenrollins.github.io/gemma-forge/journal/gotchas/nemotron-tool-parser/)).
    - (b) Reasoning consumes `max_tokens` before the call.
    - (c) Reasoning/content swap behaviour in the vLLM parser ([vLLM](https://docs.vllm.ai/en/latest/api/vllm/parser/nemotron_v3/)).
    - (d) Double-serialized args, and empty streaming content in older NIMs ([NIM 1.15](https://docs.nvidia.com/nim/large-language-models/1.15.0/release-notes.html)).
    - (e) Invented args under forced tool choice for zero-param tools ([NIM 2.0.13](https://docs.nvidia.com/nim/large-language-models/2.0.13/get-started/advanced/get-started-nemotron-3.5-super-vl.html)).
    - (f) "Tool calling may occasionally fail" on Nano NIM.
    - (g) Hitting `thinking_token_budget` empties `content` (3.5 Super-VL).

---

## 6. Latency and cost estimate (~10 tool-call incident)

Assumptions **[INFERENCE]**:
- About 11 LLM turns (≈10 tool calls + final report), with one approval pause excluded from timing.
- System prompt + 10 tool schemas ≈ 3k tokens. Each tool result is trimmed to ≤1.5k tokens.
- Context grows from 4k to about 15k, averaging ~7k input tokens per turn, so ~75k input tokens total.
- Output: about 150 tokens per tool turn with thinking off (~2k total). With full thinking, 500–1,500 reasoning tokens per turn (~10k total).

Throughput data points:
- Lightning: ~670 tok/s median on DeepInfra NVFP4 ([Artificial Analysis](https://artificialanalysis.ai/articles/nemotron-3-5-lightning-launch)).
- Super via OpenRouter: aggregator snapshots of 74–132 tok/s and 0.1–1.0 s latency ([search summary of OR / mirrors](https://openrouter.ai/nvidia/nemotron-3-super-120b-a12b), **[UNVERIFIED, snapshot-dependent]**).
- build.nvidia.com throughput: **not published [UNVERIFIED]**. Measure it on day 1.

| Configuration | Per-turn latency | ~11-turn incident | Cost per incident |
|---|---|---|---|
| Super hosted, thinking off/low | ~1.5–4 s (prefill + ~150 tok @ ~80–130 tok/s) | **~20–45 s** | $0 (build trial); ≈ 75k×$0.08/M + 2k×$0.45/M ≈ **$0.007** (OpenRouter) |
| Super hosted, full thinking | ~6–15 s | ~1.5–3 min | ≈ $0.01 |
| Lightning hosted, thinking off | ~0.5–1.5 s | **~8–15 s** | ≈ 75k×$0.05/M + 2k×$0.2/M ≈ **$0.004** |
| Local Nano/Lightning on RTX PRO 6000 | unmeasured; MoE 3B-active should be fast at batch 1 | likely <30 s [INFERENCE] | electricity |

The rate limit is the real constraint. At 40 RPM, one 11-call incident fits in a minute, but 4+ concurrent demo runs could get 429s. Mitigations: a backoff + provider fallback chain, and running the judge demo from a cassette or from the local GPU.

---

## 7. Recommendation

**Model choice**
- **Primary:** `nvidia/nemotron-3-super-120b-a12b` (hosted).
  - Strongest documented agentic numbers among the hostable mid-size models (Tau-Bench V2 avg ~61).
  - Fully documented hosted ID and reasoning switches (`enable_thinking`, `low_effort`).
  - It is the "Nemotron 3 Super" name judges will recognise.
- **Speed alternative:** Nemotron 3.5 Lightning. It is built for exactly this "execution layer" role, about 5× faster per token, and has structured-output support. Flip `NEMOTRON_MODEL` and compare 5 runs of each scenario in hour 1–2. Pick whichever passes the validator more often.

**Hosting plan, as an ordered fallback chain (all through the same OpenAI SDK)**
1. NVIDIA API catalog: `https://integrate.api.nvidia.com/v1`, `NVIDIA_API_KEY`.
2. OpenRouter, same model ID family (`nvidia/nemotron-3-super-120b-a12b` / `nvidia/nemotron-3.5-lightning`), `OPENROUTER_API_KEY`.
3. Local vLLM on the RTX PRO 6000 (Lightning NVFP4 or Nano FP8) at `http://<gpu-box>:8000/v1`. Bring it up in parallel on day 1 only if someone has spare time; it is not on the critical path.
4. Cassette replay of a recorded good run (always available, zero network).

**Minimal agent loop architecture (FastAPI)**
- `POST /incidents/{id}/run` starts an async task.
- `GET /incidents/{id}/events` streams SSE events: `llm_turn`, `tool_call`, `tool_result`, `approval_required`, `report`.
- `POST /approvals/{plan_id}` with `{approve: bool, reason}` resumes the task.
- State lives in SQLite or in-memory. The audit log is JSONL per incident.

### Python sketch

```python
# agent.py — minimal Nemotron tool loop (OpenAI SDK, NVIDIA endpoint, fallback, approval gate, evidence, JSONL log)
import json, os, time, hashlib, asyncio
from openai import OpenAI, APIError, APITimeoutError, RateLimitError
from pydantic import BaseModel, ValidationError

PROVIDERS = [  # ordered fallback chain
    dict(name="nvidia", base_url="https://integrate.api.nvidia.com/v1",
         api_key=os.getenv("NVIDIA_API_KEY"), model=os.getenv("NEMOTRON_MODEL", "nvidia/nemotron-3-super-120b-a12b")),
    dict(name="openrouter", base_url="https://openrouter.ai/api/v1",
         api_key=os.getenv("OPENROUTER_API_KEY"), model="nvidia/nemotron-3-super-120b-a12b"),
    dict(name="local", base_url=os.getenv("LOCAL_LLM_URL", "http://localhost:8000/v1"),
         api_key="none", model="model"),
]
CLIENTS = [(p, OpenAI(base_url=p["base_url"], api_key=p["api_key"], max_retries=2, timeout=60))
           for p in PROVIDERS if p["api_key"]]

# ---- tool registry: schema = pydantic model; kind gates approval ----
class IncidentArgs(BaseModel): incident_id: str
class TelemetryArgs(BaseModel): asset_id: str; window_minutes: int = 120
class ForecastArgs(BaseModel): asset_id: str
class OptimizeArgs(BaseModel): incident_id: str
class ExecuteArgs(BaseModel): plan_id: str          # must come from optimize_recovery
class Claim(BaseModel): text: str; evidence_ids: list[str]
class ReportArgs(BaseModel): summary: str; claims: list[Claim]; remaining_risks: list[str]

TOOLS = {  # name -> (ArgsModel, fn, kind, description)
    "get_telemetry":            (TelemetryArgs, lambda a: sim.get_telemetry(**a), "read",  "Current + historical measurements for an asset."),
    "forecast_failure":         (ForecastArgs,  lambda a: sim.forecast(**a),      "read",  "Deterministic time-to-limit forecast."),
    "optimize_recovery":        (OptimizeArgs,  lambda a: opt.plans(**a),         "read",  "Feasible recovery plans with costs; returns plan_ids."),
    "create_work_order":        (OptimizeArgs,  lambda a: wo.create(**a),         "consequential", "Prepare a simulated work order."),
    "execute_simulated_action": (ExecuteArgs,   lambda a: sim.execute(**a),       "consequential", "Apply an approved plan in the simulation."),
    "verify_outcome":           (IncidentArgs,  lambda a: sim.verify(**a),        "read",  "Check the outcome against the plan."),
    "submit_report":            (ReportArgs,    None,                             "final", "Final report. Every claim must cite evidence IDs."),
}
def tool_specs():
    return [{"type": "function", "function": {"name": n, "description": d,
             "parameters": m.model_json_schema()}} for n, (m, _, _, d) in TOOLS.items()]

SYSTEM = """You are Cascade's incident-response coordinator.
Workflow: Observe -> Investigate -> Forecast -> Plan -> (request approval via the consequential tool) -> Act -> Verify -> submit_report.
Only call the provided tools. Never invent numbers: every number in your report must appear in a tool result
and be cited by its evidence id, e.g. [E3]. If a tool returns an error, fix the arguments or choose another tool.
If an action is rejected, replan."""

MAX_STEPS, MAX_SAME_CALL = 16, 2

class Run:
    def __init__(self, incident_id, log_path, approver):
        self.incident_id, self.evidence, self.seen = incident_id, {}, {}
        self.log = open(log_path, "a"); self.approver = approver  # async fn(plan) -> (bool, reason)

    def emit(self, kind, **data):                    # JSONL audit log (+ forward to SSE)
        rec = {"t": time.time(), "kind": kind, **data}
        self.log.write(json.dumps(rec, default=str) + "\n"); self.log.flush()

    def chat(self, messages, thinking=False):
        last = None
        for prov, client in CLIENTS:                 # provider fallback
            try:
                t0 = time.time()
                r = client.chat.completions.create(
                    model=prov["model"], messages=messages, tools=tool_specs(), tool_choice="auto",
                    temperature=1.0, top_p=0.95, max_tokens=4096,
                    extra_body={"chat_template_kwargs": {"enable_thinking": thinking}})
                self.emit("llm_response", provider=prov["name"], latency=time.time()-t0,
                          usage=r.usage.model_dump() if r.usage else None,
                          message=r.choices[0].message.model_dump())
                return r.choices[0].message
            except (RateLimitError, APITimeoutError, APIError) as e:
                last = e; self.emit("provider_error", provider=prov["name"], error=str(e))
        raise RuntimeError(f"all providers failed: {last}")

    @staticmethod
    def parse_args(raw):
        a = json.loads(raw or "{}")
        return json.loads(a) if isinstance(a, str) else a   # double-serialization guard

    async def call_tool(self, name, raw_args):
        if name not in TOOLS: return {"error": f"unknown tool {name}", "retryable": True}
        Model, fn, kind, _ = TOOLS[name]
        try: args = Model.model_validate(self.parse_args(raw_args)).model_dump()
        except (ValidationError, json.JSONDecodeError) as e:
            return {"error": f"invalid arguments: {e}", "retryable": True}
        key = hashlib.sha1(f"{name}{json.dumps(args, sort_keys=True)}".encode()).hexdigest()
        self.seen[key] = self.seen.get(key, 0) + 1
        if self.seen[key] > MAX_SAME_CALL: return {"error": "duplicate call; reuse earlier evidence"}
        if kind == "consequential":                    # approval gate enforced in code
            self.emit("approval_required", tool=name, args=args)
            ok, reason = await self.approver({"tool": name, "args": args})
            self.emit("approval", tool=name, approved=ok, reason=reason)
            if not ok: return {"status": "rejected", "reason": reason}
            if not feasibility_check(name, args):      # independent deterministic validation
                return {"status": "blocked", "reason": "failed feasibility check; replan"}
        result = fn(args)
        eid = f"E{len(self.evidence)+1}"; self.evidence[eid] = result
        self.emit("tool_result", tool=name, args=args, evidence_id=eid, result=result)
        return {"evidence_id": eid, "data": result}

    def check_report(self, rep: ReportArgs):
        bad = [c.text for c in rep.claims if not c.evidence_ids or
               any(e not in self.evidence for e in c.evidence_ids)]
        return None if not bad else f"claims with missing/unknown evidence: {bad}"

    async def run(self):
        msgs = [{"role": "system", "content": SYSTEM},
                {"role": "user", "content": f"Alert: incident {self.incident_id}. Investigate and resolve."}]
        for step in range(MAX_STEPS):
            m = self.chat(msgs, thinking=False)
            msgs.append(m.model_dump(exclude_none=True))
            if not m.tool_calls:                          # model must act via tools
                msgs.append({"role": "user", "content": "Use a tool, or call submit_report."}); continue
            for tc in m.tool_calls[:4]:
                if tc.function.name == "submit_report":
                    rep = ReportArgs.model_validate(self.parse_args(tc.function.arguments))
                    err = self.check_report(rep)
                    if err is None:
                        self.emit("report", report=rep.model_dump()); return rep
                    out = {"error": err}
                else:
                    out = await self.call_tool(tc.function.name, tc.function.arguments)
                msgs.append({"role": "tool", "tool_call_id": tc.id, "content": json.dumps(out, default=str)[:6000]})
        self.emit("aborted", reason="max steps"); return None
```

Notes on the sketch:
- `sim`, `opt`, `wo` and `feasibility_check` are your deterministic engines.
- The OpenAI SDK is synchronous here. Wrap `chat` in `asyncio.to_thread`, or use `AsyncOpenAI` inside FastAPI.
- **Replay mode:** swap `chat()` for a function that pops the next logged `llm_response.message` from a JSONL cassette. Tools are deterministic, so the whole run reproduces.
- Remove `extra_body` for providers that reject unknown fields. OpenRouter uses its own `reasoning` parameter ([OR](https://openrouter.ai/nvidia/nemotron-3-super-120b-a12b)). **[UNVERIFIED]** whether OpenRouter passes `chat_template_kwargs` through.

**Day-1 checklist**
1. Create the NVIDIA API key and run `client.models.list()` to confirm the exact IDs for Super and Lightning.
2. Send one `tools=` request and confirm `tool_calls` is populated with `enable_thinking: False` and with `True`.
3. Read the RPM limit from the build.nvidia.com account menu.
4. Record a cassette of one good run per scenario type.

---

## 8. Open gaps

- **Lightning hosted model ID** on `integrate.api.nvidia.com`: only the URL path `nvidia/nemotron-3.5-lightning-30b-a3b` was seen; the `model=` string was not confirmed.
- **Official rate limits:** 40 RPM comes from forum users and moderators, not formal docs. Throughput and TTFT of build.nvidia.com endpoints are not published.
- **Parallel tool calls** on hosted Super/Lightning: behaviour not verified.
- **`tool_choice: "required"`** on the hosted API: the NIM docs conflict. Assume unsupported.
- **`response_format: json_schema`** on the hosted Super endpoint: not verified. Lightning's build page claims structured output.
- **RTX 6000 Ada (48 GB, sm_89):** no official recipe for any Nemotron 3/3.5 model. The FP8/W4A16 MoE kernels on Ada are untested here.
- **RTX PRO 6000 single-card Super NVFP4:** unverified. NVIDIA's Super-VL NIM profile uses 2 cards.
- **OpenRouter:** whether it forwards `chat_template_kwargs`; whether `seed` gives reproducibility.
- **Nemotron 3 Ultra, Bolt and Super-VL:** model cards were only partially read (licenses and context for Ultra/Super-VL not checked).
- **NeMo Fabric / Helix maturity:** not evaluated.
- **Hackathon-specific credits or sponsor endpoints for HackUTD 2026:** unknown; ask the NVIDIA sponsor.
