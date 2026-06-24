# AGENT.md — OpenCut-AI Improvement Project

## Project context

Repo: https://github.com/Ekaanth/OpenCut-AI (fork of OpenCut-app/OpenCut)
Stack: Next.js (apps/web) + FastAPI ai-backend + 6 Python microservices
(whisper, tts, image, speaker, face, clip-service) + turboquant-service,
orchestrated via docker-compose.yml (Postgres, Redis, Ollama included).

This file documents carry-over lessons and conventions for any agent
(Claude Code or otherwise) working on this repo. Read this before making
changes. Update it when you learn something that the next session needs.

## Goals (in priority order)

1. Make `docker compose up` work with zero manual fixing — env vars
   wired correctly end-to-end (root `.env` → compose → container → app).
2. Add a third LLM backend: OpenAI-compatible (OpenAI, OpenRouter, Groq,
   vLLM, LM Studio, etc.) alongside the existing Ollama/TurboQuant
   backends, auto-selected when configured, with graceful fallback.
3. Rewrite the AI Co-Pilot's system prompt into a real tool-calling agent
   prompt with an explicit confirmation policy (see "Confirmation policy"
   below).
4. Wire up real implementations for the agent's editing actions — many
   currently exist only as `console.warn(...)` stubs — and add new tools
   for scene detection, auto-cut, auto-transition, auto-audio cleanup,
   and AI-readable scene/person descriptions.
5. Normalize GoPro/iPhone camera footage on ingest so it's editor- and
   pipeline-compatible (container/codec/rotation/HDR quirks).
6. Run a standard ingest pipeline on every asset added to a project
   (object detection, scene description, transcript, EXIF/metadata
   extraction) so the agent has structured per-asset context without
   re-deriving it per-request.
7. Guarantee project data (including all of the above derived metadata)
   is durably persisted, not just held in memory/OPFS ephemeral state.
8. Make image generation and scene description swappable to any
   OpenAI-compatible (vision) endpoint, same pattern as the LLM backend.
9. Make the agent's tool set complete enough for genuinely advanced
   editing, not just the current narrow action list.
10. Auto-select background music/SFX via Freesound or equivalent, driven
    by transcript/scene mood rather than the user picking manually.
11. Auto-reframe using real object detection (not just face detection)
    for non-person subjects (pets, products, sports, etc.).

## Confirmation policy (decided, do not relitigate)

- Non-destructive actions (add subtitle track, add music, add text
  overlay, generate image, color correct, normalize audio, auto-duck,
  add transition, add chapter markers, auto-reframe preview, ingest
  pipeline steps) → auto-execute, no confirmation.
- Destructive/irreversible-feeling actions (REMOVE_SEGMENTS,
  REMOVE_SILENCE, REMOVE_FILLERS, TRIM_CLIP, SPLIT_CLIP, EXPORT_PROJECT,
  anything that deletes or overwrites timeline content or original
  source files) → always show the step in the plan and require explicit
  user confirmation before executing, even in "auto-run" mode.
- Format/codec conversion of an uploaded source file (Phase 5) counts as
  destructive if it replaces the original; non-destructive if it
  produces a new derived/proxy file alongside the original. Default to
  non-destructive (keep original, generate a normalized derivative) —
  see Phase 5 notes.
- This must be enforced in the system prompt AND in the executor (don't
  rely on the LLM alone to gate destructive ops — the client-side
  executor must also check an `isDestructive` flag per action type).

## Known architecture facts (verified against source, don't re-derive)

- `services/ai-backend/app/services/model_backend.py` is the single
  chokepoint for all LLM calls (`generate`, `generate_stream`,
  `generate_json`, `chat`). It already routes Ollama ⇄ TurboQuant. The
  OpenAI-compatible backend must be added here as a third path, not
  bolted on elsewhere.
- `apps/web/src/types/ai.ts` defines `EditorActionType` — used by the
  Co-Pilot (`apps/web/src/lib/copilot/copilot-types.ts`,
  `apps/web/src/hooks/use-copilot.ts`).
- `apps/web/src/lib/ai-action-executor.ts` is where Co-Pilot actions are
  actually executed client-side. As of the last audit, these action
  types are STUBS that only `console.warn`: `NORMALIZE_AUDIO`,
  `AUTO_DUCK`, `COLOR_CORRECT`, `ADD_SUBTITLE_TRACK`,
  `ADD_IMAGE_OVERLAY`, `TRIM_CLIP`, `ADD_TRANSITION`, `ADD_VOICEOVER`,
  `DENOISE_AUDIO`, `GENERATE_IMAGE`, `ADD_MUSIC`, `EXPORT_PROJECT`. These
  need real implementations calling existing editor/timeline APIs and/or
  `aiClient` backend calls.
- There is a SECOND, separate action vocabulary in
  `services/ai-backend/app/routes/command.py` (`cut`, `trim`, `delete`,
  `add_text`, etc.) used by `aiClient.executeCommand()` /
  `/api/llm/command`. This is disconnected from the Co-Pilot's
  `EditorActionType` system. Do not assume they're the same — reconcile
  or explicitly bridge them, don't silently duplicate.
- Real, callable backend capabilities already exist but are NOT wired
  into the agent as tools: `silence_service.py` (silence detection),
  `clip_detector.py` (multi-signal best-clip scoring), `topic_detector.py`
  (chapter/topic boundaries via LLM), `face_reframe.py` (face-tracking
  crop trajectories), `subtitle_service.py` (SRT/VTT generation). The
  agent tool layer should call these, not reimplement them.
- No scene/person visual description tool exists yet for AI input (the
  README's "AI Scene Detection" is client-side color-histogram cut
  detection only — it finds *when* a cut happens, not *what* is in the
  frame). This needs a new tool, likely combining face-service +
  clip-service (CLIP zero-shot tags) + a frame-sampling step, then
  feeding a text description to the LLM.
- No general object detection service exists yet (face-service is
  face-only via mediapipe). Auto-reframe today is face-tracking only
  (`face_reframe.py`). A real object detector (e.g. YOLOv8/ONNX or an
  open-vocabulary detector) is needed for non-person subjects and for
  the ingest pipeline's object-detection step. This is new
  infrastructure, not a rewire of something existing.
- No asset ingest pipeline exists yet. Today, transcription/analysis
  happens on-demand per-feature (user clicks "transcribe", "denoise",
  etc.), not automatically when a file is added to a project. Phase 6
  introduces this as new infrastructure (a job queue consumer), it does
  not just wire up existing buttons.
- No video format-normalization step exists yet. GoPro (commonly
  HEVC/H.265 in MP4, sometimes with GPMF metadata track, sometimes
  high-FPS/HDR variable frame rate) and iPhone (HEVC in MOV, with
  `rotation` matrix in the moov atom rather than baked-in pixels, and
  ProRes/Dolby Vision on newer models) footage can both fail or render
  incorrectly in browser-based playback/WebGL preview without an
  explicit transcode/remux step. This is new infrastructure (Phase 5).
- Persistence today: `DATABASE_URL` (Postgres via `apps/web`) exists for
  *some* project state already (see `apps/web/migrations/`), and most
  media/timeline data lives in OPFS (Origin Private File System) per the
  README ("All data local... Files stored in OPFS"). Derived AI metadata
  (transcripts, detected objects, scene descriptions, EXIF) does NOT yet
  have a defined persistence target — confirm during Phase 6/7 whether
  it should live in Postgres (queryable, multi-asset joins) vs. OPFS
  (consistent with existing media storage) vs. both (Postgres for
  metadata, OPFS/disk for large blobs like transcripts). Recommend
  Postgres for structured per-asset metadata since the agent will query
  it ("find clips with a dog in them"), with large text blobs
  (full transcripts) either inline (if small) or referenced by path.
- `clip-service` already does CLIP embeddings + zero-shot tagging
  (`POST /api/search/zero-shot-tags`, `embed-frames`, `embed-text`) —
  this is a candidate building block for object/content tagging in the
  ingest pipeline and for scene description, not something to duplicate.
- Freesound integration already exists for manual sound search
  (`FREESOUND_CLIENT_ID`/`FREESOUND_API_KEY`, `getFreesoundHeaders()` in
  `apps/web/src/lib/api-keys.ts`). Auto-selection (Phase 9) should call
  the existing Freesound search path programmatically from the agent,
  not reimplement Freesound auth.
- Root `.env.example` did not exist before this project (only
  `apps/web/.env.example` and `services/ai-backend/.env.example`).
  `docker-compose.yml` reads root `.env` via `${VAR:-default}`
  substitution — without it, several features silently no-op.
- `NEXT_PUBLIC_*` env vars (Sarvam, Smallest, Seedance, Replicate,
  Stability, Luma API keys) must be passed as Docker build `ARG`s, not
  just runtime `environment:`, to be inlined into the Next.js client
  bundle. Previously several were missing as build args entirely.
- `ai-backend`'s `config.py` defines `SMALLEST_API_KEY`,
  `SEEDANCE_API_KEY`, `REPLICATE_API_TOKEN`, `STABILITY_API_KEY`,
  `LUMA_API_KEY` but `docker-compose.yml` previously did not pass any of
  them through as `OPENCUTAI_*` env vars to the `ai-backend` container —
  always blank in Docker regardless of `.env`.

## Conventions to follow

- Settings UI for API keys follows a strict pattern in
  `apps/web/src/components/editor/panels/assets/views/settings.tsx`
  (`API_KEY_FIELDS` array + `APIKeysSection`). New provider keys go here,
  matching the existing field shape (`key`, `label`, `placeholder`,
  `description`, `envVar`, `envValue`, `info`, `required`).
- Backend settings follow Pydantic `BaseSettings` in `app/config.py`,
  prefixed `OPENCUTAI_`, mirrored into `.env.example` with comments.
- "OpenAI-compatible" is now a pattern used in THREE places (LLM text,
  image generation, vision/scene-description) — implement it once as a
  small shared client helper (base_url + api_key + model + optional
  extra headers → POST to the right sub-path) and reuse it for chat
  completions, image generation (`/images/generations`), and vision
  (`/chat/completions` with image content parts), rather than three
  separate ad-hoc HTTP clients.
- `"types": ["node"]` must stay in tsconfig where applicable (lesson
  from prior unrelated project, keep an eye out for tsconfig drift in
  this repo too).
- Don't assume API/field names — verify shapes against actual source
  before calling. This codebase has many near-identical but distinct
  systems (two action vocabularies, multiple "scene" concepts — visual
  cut detection vs. the version-control "scenes manager" in
  `core/managers/scenes-manager.ts` — don't confuse them).
- No Docker daemon available in some dev/agent sandboxes — verify
  Python/TS syntax and type-check statically (`bun run typecheck`,
  `python -m py_compile`, `ruff`/`mypy` if configured) when you can't
  actually run `docker compose up`. Flag clearly in PR description what
  was verified statically vs. actually run end-to-end.
- Any new heavy dependency (object detector model weights, ffmpeg
  filters for GoPro/iPhone transcode, etc.) must follow the existing
  per-service `requirements.txt` + `requirements.lock` (`uv pip compile
  --universal`) pattern documented in the README — don't hand-edit lock
  files.
- New persistent metadata tables go through the existing migrations
  mechanism in `apps/web/migrations/` (Drizzle or whatever is already in
  use there — check before assuming) rather than ad-hoc SQL.

## Open questions to confirm with the user before deep work

- Which OpenAI-compatible provider(s) specifically (OpenAI vs.
  OpenRouter vs. self-hosted vLLM/LM Studio) — affects whether extra
  headers / auth quirks matter.
- Whether agent tool calls should use the model's native tool-calling
  (function calling) if the configured OpenAI-compatible model supports
  it, vs. continuing the existing JSON-in-prompt pattern used by Ollama
  (which often lacks robust tool calling on small local models). Likely
  needs a capability-detection branch.
- Object detector choice for Phase 11/6 (YOLOv8/ONNX is the obvious
  local default mentioned by the user; confirm licensing is acceptable —
  AGPL on some YOLO distributions — and whether GPU is assumed
  available, since this is a new always-on ingest step, not optional
  like image generation).
- Whether ingest-pipeline processing (Phase 6) should block "asset
  ready to use" in the UI until done, or asset is usable immediately
  with metadata arriving asynchronously (recommend async — don't block
  the editor on a potentially slow pipeline).
- Whether GoPro/iPhone normalization (Phase 5) should run automatically
  on every upload, or only when source format is detected as
  problematic (recommend: detect-and-conditionally-convert, not
  blanket-transcode everything, to avoid wasting time/quality on files
  that are already fine).