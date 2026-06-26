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
3. Rewrite the AI Co-Pilot to use a real tool-calling ReAct loop agent architecture
   (Reason -> Act -> Observe -> Reason again) with an explicit confirmation policy.
   The loop should support query tools (e.g. LIST_MEDIA, GET_MEDIA_METADATA) and timeline
   actions, capping at a maximum number of iterations (e.g., 8) to prevent runaways.
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
  (`face_reframe.py`). A real object detector (YOLOv8 `yolov8n.pt`) has been
  added to the ingest pipeline (`ingest_pipeline.py`) to detect and tag objects in video frames and images.
- No asset ingest pipeline exists yet. Today, transcription/analysis
  happens on-demand per-feature (user clicks "transcribe", "denoise",
  etc.), not automatically when a file is added to a project. Phase 6
  introduces this as new infrastructure (a job queue consumer), it does
  not just wire up existing buttons. The ingest pipeline now handles both videos and static images differently.
- No video format-normalization step exists yet. GoPro (commonly
  HEVC/H.265 in MP4, sometimes with GPMF metadata track, sometimes
  high-FPS/HDR variable frame rate) and iPhone (HEVC in MOV, with
  `rotation` matrix in the moov atom rather than baked-in pixels, and
  ProRes/Dolby Vision on newer models) footage can both fail or render
  incorrectly in browser-based playback/WebGL preview without an
  explicit transcode/remux step. This has been resolved in Phase 5: 
  The pipeline now checks if format is `.mov` or codec is `hevc`/`h265` or has `gpmd` metadata, 
  and normalizes these specific files to `libx264` MP4 via FFmpeg.
- Persistence today: `DATABASE_URL` (Postgres via `apps/web`) exists for
  *some* project state already (see `apps/web/migrations/`), and most
  media/timeline data lives in OPFS (Origin Private File System) per the
  README ("All data local... Files stored in OPFS"). Derived AI metadata
  (transcripts, detected objects, scene descriptions, EXIF) does NOT yet
  have a defined persistence target. Phase 7 conclusion: 
  `assetMetadata`, `transcripts`, `detectedObjects`, and `sceneDescriptions` 
  are structurally persisted in Postgres (`schema.ts`), linked via `assetId` 
  to the OPFS project assets. Batch APIs are used by the AI context to retrieve them.
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
- The AI Co-Pilot uses a unified, recursive ReAct loop agent runner implemented
  in `apps/web/src/lib/copilot/agent-loop.ts`. This utility handles tool calling
  (`LIST_MEDIA`, `GET_MEDIA_METADATA`, `GET_TIMELINE_STATE`) and streams
  live reasoning tokens to the UI, returning a final `CopilotPlan` to the caller.

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

## Implemented System Architectures (Phase 1 to 8 Summary)

- **OpenAI-Compatible Providers**: Integrations are standardized to allow OpenAI, OpenRouter, and local vLLM/LM Studio. Configuration fields exist in settings panel and are saved to browser local settings and forwarded as API headers.
- **Agent Loop and Native Function Calling**: The Co-Pilot leverages a recursive ReAct agent loop in client-side TS with server-side JSON tool calls, falling back gracefully for models that don't support native tool definitions.
- **GoPro/iPhone Normalization**: The backend checks for HEVC / MOV / GPMF files and transcodes them conditionally to H.264 mp4. This handles rotation and browser compatibility correctly.
- **Ingest Pipeline**: Ingest triggers asynchronously when a file is imported. It runs scene detection, transcription, CLIP zero-shot tagging, and EXIF/metadata extraction without blocking the main editor UI.
- **Durable Metadata Persistence**: Derived assets metadata, transcript segments, and tags are persisted in Postgres schema (`schema.ts`) and linked by `assetId` to OPFS files.
- **Polished Chat UI/UX**:
  - Collapsible tool logs rendering raw reasoning and JSON tool execution.
  - Automatic scrolling behavior ensuring the current thinking tokens and plan steps are visible, while maintaining readable layout for previous response segments.
  - Linear execution block displaying upcoming steps of editing plans, with explicit validation of destructive vs non-destructive action types.
  - Quick action suggestion pills above the input textarea.
  - Mic button supporting native `SpeechRecognition` web API with a fallback to WAV-recorded blobs sent to `/api/transcribe`.
  - Auto-resizing textarea input.