# AGENT.md — OpenCut-AI Improvement Project (v2)

## Project context

Repo: https://github.com/randyaswin/OpenCut-AI (fork of OpenCut-app/OpenCut, via
Ekaanth/OpenCut-AI)
Stack: Next.js (apps/web) + FastAPI ai-backend + Python microservices (whisper, tts, image,
speaker, face, clip-service) + turboquant-service, orchestrated via docker-compose.yml
(Postgres, Redis, Ollama included).

This file is a continuation of the previous `AGENTS.md`. Phases 1–8 from that document were
audited as implemented (see "Carried-over status" below) — **do not redo them**, but DO
re-verify the specific claims against current `main` before building on top of them, since this
document was written from README + prior AGENTS.md content, not a fresh source read.

This v2 round has two missions:
1. **Finish making the agent actually execute what it plans** (stub closure + tool-set
   expansion) — the previous round built the skeleton (ReAct loop, confirmation policy,
   ingest pipeline, persistence); this round makes the skeleton functionally complete.
2. **Close the highest-impact feature gaps vs. CapCut** identified in `REVIEW.md`, prioritizing
   things buildable by composing capabilities that already exist in this codebase.

Read `REVIEW.md` before this file if you want the reasoning behind what's prioritized and why.

## Carried-over status from AGENTS.md v1 (do not re-litigate, but DO re-verify)

These were marked done based on a prior audit. Confirm they still hold, then move on:

- ✅ OpenAI-compatible LLM backend (third path alongside Ollama/TurboQuant) in
  `model_backend.py`, auto-selected with fallback.
- ✅ ReAct agent loop (`apps/web/src/lib/copilot/agent-loop.ts`) with query tools
  (`LIST_MEDIA`, `GET_MEDIA_METADATA`, `GET_TIMELINE_STATE`), streaming reasoning to UI.
- ✅ Confirmation policy enforced in both system prompt and client-side executor
  (`isDestructive` flag per action type) — **this pattern must extend to every new action
  type added in this round**.
- ✅ GoPro/iPhone normalization on ingest (HEVC/MOV/GPMF detection → conditional FFmpeg
  transcode to H.264 MP4).
- ✅ Async asset ingest pipeline (scene detection, transcription, CLIP zero-shot tagging,
  EXIF/metadata extraction) triggered on upload, non-blocking.
- ✅ Durable metadata persistence (Postgres `schema.ts`, linked by `assetId` to OPFS files).
- ✅ Polished chat UI/UX (collapsible tool logs, auto-scroll, linear execution block, quick
  action pills, mic input with `SpeechRecognition` + WAV fallback, auto-resize textarea).

Still open from v1 (carry forward into this plan's phases, renumbered below):
- ⬜ Phase 9 (auto sound/music selection via Freesound) — not yet executed in code per last
  audit. → becomes Phase 9 here, unchanged in scope, just re-sequenced.
- ⬜ Phase 10/11 (object-detection-based auto-reframe beyond faces) — object detector exists
  in the ingest pipeline (YOLOv8) per v1 audit, but `face_reframe.py` extension to non-face
  subjects was not confirmed done. → becomes Phase 10 here.
- ⬜ The stub action executor closure (4a in old PLAN.md) — confirm current state; if still
  stubbed, this is now the **highest priority item** in this round (Phase 13 below), because
  no amount of new agent intelligence matters if the agent can't execute its own plan.

## Goals (in priority order, this round)

1. **Close every remaining stub in `ai-action-executor.ts`.** An agent that plans but cannot
   execute is not "maximal" regardless of how good its reasoning is. This is non-negotiable
   priority #1 before any new feature work.
2. **Unify the two action vocabularies** (`EditorActionType` used by Co-Pilot vs. the
   `cut`/`trim`/`delete`/`add_text` vocabulary in `command.py`) or explicitly bridge them with a
   documented adapter — stop letting them drift further apart with every new feature.
3. **Expose existing-but-unreachable backend capabilities as agent tools**: `silence_service`,
   `clip_detector`, `topic_detector`, `face_reframe`, `subtitle_service`, beat detection, and
   the CLIP zero-shot tagger. The agent should call these instead of guessing timestamps or
   re-deriving information that's already computed and stored.
4. **Add granular observation tools** so the agent can inspect specific moments instead of only
   reasoning from ingest-time summaries: `GET_FRAME_AT(timestamp)` (returns a sampled frame as
   an image for vision-capable models), `GET_TRANSCRIPT_RANGE(start, end)`, `GET_CLIP_NEIGHBORS`
   (what's immediately before/after a given clip on the timeline). Without this, the agent
   cannot do anything that requires looking at a specific point in the edit, only summary-level
   reasoning.
5. **Add a batch-operation primitive**: a single action type that applies a transform (cut,
   transition, filter, mute) across a *set* of matched segments/clips, with one confirmation
   gate for the whole batch rather than N separate gates. Needed for goals like "remove all
   filler words in the whole video" to be usable without confirmation fatigue.
6. **Make the agent template-aware**: expose the 8 existing project templates as a tool
   (`LIST_TEMPLATES`, `APPLY_TEMPLATE`) so goal-described requests ("make this a TikTok vlog")
   can start from a matching template rather than building a timeline from zero every time.
7. **Close the highest-impact CapCut feature gaps** identified in `REVIEW.md`, in this order
   (each chosen because it composes existing building blocks rather than requiring new core
   infrastructure):
   - Auto-translate + auto-dub pipeline (transcript → LLM translate → TTS in target voice).
   - Auto-cut-to-beat (beat detection → cut point generation, as one agent action).
   - Cross-clip color match (sample reference clip's color stats → apply correction to target
     clip(s), not just preset-based correction).
   - AI B-roll insertion from transcript (detect "boring"/low-visual-variety segments via
     existing scene description + silence/energy signals → suggest or generate cutaway via
     existing AI Video Generation Hub).
   - Reverse / loop / boomerang clip effect (FFmpeg filter — low effort, bundle with other
     quick "effect" wins).
   - Per-word animated caption presets (pop/bounce/typewriter), extending the existing
     karaoke/pill/classic subtitle styling.
8. **AI background removal without a green screen** (matting/segmentation model — e.g. RVM,
   MODNet, or a SAM-family lightweight variant — added as a new microservice following the
   existing per-service `requirements.txt`/`requirements.lock` pattern). This is the single
   highest-value gap vs. CapCut that genuinely requires new model infrastructure rather than
   recombination — sequence it after the lower-effort items above, not before.
9. (Carried from v1) Auto-select background music/SFX via Freesound, mood/energy-driven.
10. (Carried from v1) Extend auto-reframe to non-person subjects using existing object
    detection output.

## Confirmation policy (decided in v1, extended here — do not relitigate the base rule)

Base rule unchanged: non-destructive auto-executes; destructive/irreversible-feeling requires
explicit confirmation; this must be enforced in both system prompt and client-side executor.

Extensions needed this round:
- **Batch operations** (Goal 5): the *batch as a whole* gets one confirmation step showing all
  matched segments before execution, if any individual action in the batch is destructive. The
  agent must show the full match list (not just a count) so the user can deselect items before
  confirming.
- **Cross-clip color match and B-roll insertion** are non-destructive (they add/adjust, don't
  remove) → auto-execute, but the *generation* sub-step (calling a paid video-gen API for B-roll)
  should still surface estimated cost/time if the configured provider is metered, before
  insertion — this is a cost-transparency concern, not strictly a destructiveness one; encode it
  as a separate `requiresCostConfirmation` flag if the existing `isDestructive` flag doesn't fit
  cleanly. Don't overload `isDestructive` with unrelated semantics.
- **Auto-dub** replacing original audio is destructive (overwrites the audio track) unless it's
  added as a new alternate audio track — default to the non-destructive form (new track,
  switchable), per the same precedent set for GoPro/iPhone normalization in v1 (keep original,
  add derivative).
- **Background removal** is non-destructive if applied to a duplicated/matted layer; destructive
  if it replaces the original clip's pixels in place. Default to non-destructive.

## Known architecture facts (carried from v1 — re-verify before trusting, don't re-derive)

- `services/ai-backend/app/services/model_backend.py` is the single chokepoint for all LLM
  calls (`generate`, `generate_stream`, `generate_json`, `chat`); already routes
  Ollama ⇄ TurboQuant ⇄ OpenAI-compatible (verify the third path is actually live, per v1 Phase 2).
- `apps/web/src/types/ai.ts` defines `EditorActionType`, used by `copilot-types.ts` and
  `use-copilot.ts`.
- `apps/web/src/lib/ai-action-executor.ts` is where Co-Pilot actions execute client-side. **Per
  the Phase 0 audit, all previously-listed stubs (NORMALIZE_AUDIO, AUTO_DUCK, COLOR_CORRECT, ADD_SUBTITLE_TRACK,
  ADD_IMAGE_OVERLAY, TRIM_CLIP, ADD_TRANSITION, ADD_VOICEOVER, DENOISE_AUDIO, GENERATE_IMAGE, ADD_MUSIC,
  EXPORT_PROJECT) are actually already fully implemented and wired.**
- The previously separate action vocabulary in `services/ai-backend/app/routes/command.py`
  (`cut`, `trim`, `delete`, `add_text`, etc.) **has been fully deprecated and reconciled**. `command.py`
  now exclusively returns `EditorActionType` JSON matching the Co-Pilot actions, resolving Goal 2.
- `silence_service.py`, `clip_detector.py`, `topic_detector.py`, `face_reframe.py`,
  `subtitle_service.py` are real, tested backend capabilities. Per v1 audit they were *still not
  wired in as agent tools* as of last check — re-verify, this is Goal 3.
- Object detection (YOLOv8, `yolov8n.pt`) was added to the ingest pipeline in v1
  (`ingest_pipeline.py`). This is the foundation for Goal 10 (non-face auto-reframe) — don't
  rebuild detection, only extend `face_reframe.py`'s crop-trajectory logic to accept non-face
  detected objects as the tracked subject.
- `clip-service` does CLIP embeddings + zero-shot tagging (`/api/search/zero-shot-tags`,
  `embed-frames`, `embed-text`) — reuse for B-roll relevance matching (Goal 7) rather than
  building a separate content-matching system.
- Freesound integration exists for manual sound search (`FREESOUND_CLIENT_ID`/
  `FREESOUND_API_KEY`, `getFreesoundHeaders()` in `apps/web/src/lib/api-keys.ts`) — Goal 9 calls
  this programmatically, doesn't reimplement auth.
- Beat detection exists (BPM, beat strength visualization, snap-to-beats) per README — Goal 7's
  auto-cut-to-beat reuses this, adding only the "generate cut points at beat boundaries" logic
  and the agent action wrapper, not new beat-detection code.
- 8 project templates exist (YouTube Intro, TikTok Vlog, Podcast Highlight, Product Review,
  Classroom Lesson, Instagram Reel, Travel Vlog, Tutorial) with search/filter/apply UI — Goal 6
  exposes the existing apply mechanism as an agent tool, doesn't build a new template system.
- No general-purpose background matting/segmentation service exists yet (face-service is
  mediapipe face-only; chroma key requires an actual physical green screen). Goal 8 is new
  infrastructure — sequence it last among the feature-gap goals, after the recombination-only
  items, per the effort/impact ordering in `REVIEW.md`.
- No translation step exists in the pipeline yet (transcription and TTS are separate, unconnected
  features per the source list). Goal 7's auto-dub needs a new but small "translate transcript
  segments" step using the existing LLM backend (`model_backend.generate_json` with a translation
  prompt) — don't add a dedicated translation API/service unless the LLM-based approach proves
  insufficient in testing.

## Conventions to follow (carried from v1, unchanged — these are still correct)

- Settings UI for new API keys (e.g. a future segmentation-model config, if it needs external
  inference) follows the `API_KEY_FIELDS` array + `APIKeysSection` pattern in
  `apps/web/src/components/editor/panels/assets/views/settings.tsx`.
- Backend settings follow Pydantic `BaseSettings` in `app/config.py`, prefixed `OPENCUTAI_`,
  mirrored into `.env.example` with comments.
- "OpenAI-compatible" client helper (LLM text, image gen, vision) should be reused, not
  reimplemented, for the translation step in Goal 7 (it's just another `generate_json` call
  through the existing chat completion path).
- `"types": ["node"]` must stay in tsconfig where applicable.
- Don't assume API/field names — verify shapes against actual source before calling. Watch for
  near-identical-but-distinct systems (two action vocabularies per Goal 2; "scene detection"
  visual cut-detection vs. the version-control `core/managers/scenes-manager.ts` — still
  unrelated, still don't conflate).
- No Docker daemon may be available in some dev/agent sandboxes — verify statically
  (`bun run typecheck`, `python -m py_compile`, `ruff`/`mypy`) when you can't run
  `docker compose up`. Flag clearly what was verified statically vs. actually run.
- New heavy dependencies (e.g. a matting model's weights for Goal 8) follow the existing
  per-service `requirements.txt` + `requirements.lock` (`uv pip compile --universal`) pattern.
  A new model service (e.g. `matting-service`) follows the same Dockerfile/uv/lockfile shape as
  the existing seven Python services — check `face-service`'s Dockerfile as the closest analog
  (small CV model, possible platform pinning if the chosen model lacks aarch64 Linux wheels).
- New persistent metadata (e.g. per-asset matting masks, translation cache, beat-grid cut points)
  goes through the existing migrations mechanism in `apps/web/migrations/`.
- Any new agent action type must (a) get added to `EditorActionType` in `ai-action-executor.ts`
  with a real implementation from day one — no new stubs are to be merged, ever, given Goal 1's
  priority — and (b) get an explicit `isDestructive` (and, where relevant,
  `requiresCostConfirmation`) classification at definition time, not as an afterthought.

## What "maximal" means for this agent (definition of done for the AI-agent review)

The AI Co-Pilot is considered maximal for this round when:
- Every action type it can plan, it can actually execute (Goal 1).
- It can call every analysis capability the backend already has, instead of guessing (Goal 3).
- It can observe specific moments in the timeline on demand, not just ingest-time summaries
  (Goal 4).
- It can act on "the whole video" goals without per-clip confirmation fatigue (Goal 5).
- It can start from a matching template instead of zero (Goal 6).
- It has parity (not superiority — that's a longer-term goal) with CapCut's highest-traffic
  AI-assist features: auto-dub, beat-synced cuts, cross-clip color match, AI B-roll suggestion,
  and background removal without a green screen (Goals 7–8).

This is intentionally scoped to be achievable in one well-resourced execution pass, not a
rewrite. Phase 9–11 items carried from v1 remain valid and are sequenced into the plan below.