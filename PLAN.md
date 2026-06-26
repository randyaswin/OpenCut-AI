# PLAN.md — OpenCut-AI Improvement Project

Status: NOT STARTED — this is a plan for an agent to execute, no code
has been changed in the actual repo yet beyond a throwaway audit.

## Phase 0 — Setup
- [ ] create a feature branch.
- [ ] Read AGENT.md fully.
- [ ] Re-verify the "Known architecture facts" against current `main`
      (the repo may have moved since this plan was written) — grep for
      the specific files/functions named before trusting them.

## Phase 1 — Make it run cleanly
- [ ] Add root `.env.example` covering every `${VAR:-default}` referenced
      in `docker-compose.yml` (LLM backend selection, Ollama model,
      Whisper size, memory/tier budgets, KV cache bits, TurboQuant model,
      compute mode, HF_TOKEN, Sarvam/Smallest/Seedance/Replicate/
      Stability/Luma keys, CLIP model config, Freesound, Marble, R2/Modal
      transcription, BETTER_AUTH_SECRET).
- [ ] Fix `ai-backend` service block in `docker-compose.yml`: pass
      through `OPENCUTAI_SMALLEST_API_KEY`, `OPENCUTAI_SEEDANCE_API_KEY`,
      `OPENCUTAI_REPLICATE_API_TOKEN`, `OPENCUTAI_STABILITY_API_KEY`,
      `OPENCUTAI_LUMA_API_KEY` (defined in `config.py`, never wired).
- [ ] Fix `apps/web/Dockerfile`: add missing `ARG`/`ENV` pairs for
      `NEXT_PUBLIC_SARVAM_API_KEY`, `NEXT_PUBLIC_SMALLEST_API_KEY`,
      `NEXT_PUBLIC_SEEDANCE_API_KEY`, `NEXT_PUBLIC_REPLICATE_API_TOKEN`,
      `NEXT_PUBLIC_STABILITY_API_KEY`, `NEXT_PUBLIC_LUMA_API_KEY` so
      they're inlined at build time, not just set at runtime.
- [ ] Fix `web` service `build.args` in `docker-compose.yml` to pass the
      above through from root `.env`.
- [ ] Fix hardcoded `BETTER_AUTH_SECRET` in the `web` service to read
      from `${BETTER_AUTH_SECRET:-...}` instead of a literal string.
- [ ] Validate `docker-compose.yml` syntax (YAML parse at minimum; run
      `docker compose config` if Docker is available in the execution
      environment).
- [ ] Do a real `docker compose build --parallel && docker compose up -d`
      run if the environment allows it; capture and fix any startup
      errors per-service (check `docker compose logs <service>` for each
      of the 13 services). If Docker isn't available, document exactly
      what couldn't be verified.
- [ ] Confirm `/health` (ai-backend) and `/api/health` (web) both return
      200 once stack is up.

## Phase 2 — OpenAI-compatible LLM backend
- [ ] `app/config.py`: add `OPENAI_BASE_URL`, `OPENAI_API_KEY`,
      `OPENAI_MODEL`, `OPENAI_TIMEOUT`, `OPENAI_EXTRA_HEADERS` settings
      (prefixed `OPENCUTAI_` via existing `env_prefix`).
- [ ] `services/ai-backend/.env.example`: document the new vars with
      examples for OpenAI, OpenRouter, Groq, LM Studio, vLLM.
- [ ] `app/services/model_backend.py`: add `_openai_generate`,
      `_openai_generate_stream`, `_openai_chat` methods following the
      same shape as the existing `_tq_*` methods (they already hit an
      OpenAI-compatible `/v1/chat/completions` endpoint on TurboQuant, so
      the request-building logic is nearly identical — reuse/extract a
      shared helper if it cleans things up; per AGENT.md conventions,
      this shared helper should be designed so Phase 8 and Phase 9b can
      reuse it for image/vision endpoints too).
- [ ] Add `_should_use_openai_compatible()` selection logic: returns true
      when `AI_LLM_BACKEND` is `"openai_compatible"`, or `"auto"` AND
      `OPENAI_API_KEY` is non-empty. Auto-priority order: openai_compatible
      → turboquant → ollama.
- [ ] Update `generate`, `generate_stream`, `generate_json`, `chat`,
      `check_available`, `get_status` to branch through the new backend
      with try/except fallback to the next backend in priority order, not
      just to Ollama (don't regress the existing TurboQuant fallback
      behavior).
- [ ] `app/routes/llm.py`: surface `active_backend` correctly including
      `"openai_compatible"`, and the configured model name, in
      `/api/llm/status`.
- [ ] Frontend: add `openaiCompatible` field to `API_KEY_FIELDS` in
      `settings.tsx` (key, base URL, model — likely 3 inputs grouped, not
      the single-field pattern used elsewhere; check whether the existing
      component supports multi-field groups or needs a small variant).
- [ ] Frontend: `apps/web/src/lib/ai-client.ts` — confirm whether the
      frontend needs to send any client-set override (e.g. user pastes
      their own OpenAI key in Settings rather than env) through to
      `/api/llm/chat` per-request, matching the existing
      `getStoredApiKey`/header-passthrough pattern used for Sarvam/
      Smallest/Seedance/Replicate/Stability/Luma. Decide: does the
      OpenAI-compatible key live server-side only (env), or can the user
      override it from the browser? Recommend server-side env only for
      v1 (simpler, keeps key off the client) unless the user specifically
      wants BYOK-from-browser.
- [ ] Test against at least one real OpenAI-compatible endpoint
      (suggest: a free/cheap one like Groq or a local LM Studio instance)
      to confirm `generate_json` parsing still works — small/local models
      are flaky at strict JSON; the existing `_parse_json_response` repair
      logic in `model_backend.py` should already help here, verify it's
      not bypassed for the new backend.

## Phase 3 — Rewrite the agent system prompt
- [ ] Replace `COPILOT_SYSTEM_PROMPT` in
      `apps/web/src/lib/copilot/copilot-types.ts` with a prompt that:
      - Explicitly lists tool/action types with params (keep the
        existing list, extend per Phase 4/9/10/11).
      - States the confirmation policy from AGENT.md explicitly: which
        action types are auto-executable vs. require confirmation, and
        instructs the model to still emit confirmable steps in the plan
        (don't omit them) but mark them.
      - Adds a `requiresConfirmation` field at the per-step level (today
        it's only a single plan-level boolean) — update
        `CopilotStep`/`CopilotPlan` types in `copilot-types.ts`
        accordingly, and `use-copilot.ts`'s `executePlan` to pause and
        wait for per-step confirmation when that flag is true, rather
        than running straight through.
      - Encourages multi-step plans that chain tool outputs (e.g.
        transcribe → detect silence → remove silence → detect topics →
        add chapters) rather than one-shot single actions.
      - Gives the model the actual current project context shape (it
        already receives `buildProjectContext()` output — make sure the
        prompt explains what that JSON means, and extend that context to
        include per-asset ingest metadata from Phase 6 once it exists, so
        the agent can reason over "which clip has a dog in it" without an
        extra round-trip).
- [ ] Add a companion "agent mode" system prompt variant (or a flag in
      the same prompt) for fully autonomous multi-tool runs vs. simple
      single-command natural language edits — decide whether
      `command.py`'s `COMMAND_SYSTEM_PROMPT` should be deprecated in
      favor of routing everything through the Co-Pilot's richer action
      set, or kept separate for quick single commands. Recommend:
      keep `command.py` for fast single-shot text commands ("speed up
      the middle"), use the Co-Pilot path for anything multi-step or
      goal-described.

## Phase 4 — Real tool implementations + new tools

### 4a. Fix existing stubs in `ai-action-executor.ts`
For each of these, replace the `console.warn` stub with a real
implementation, calling either `EditorCore` timeline APIs directly (like
`SPLIT_CLIP`/`ADJUST_SPEED` already do) or `aiClient` backend calls
(like TTS/image gen):
- [ ] `TRIM_CLIP` — call timeline trim API on the matching element.
- [ ] `ADD_TRANSITION` — call timeline transition-insert API; verify
      against the 20 built-in transitions named in the README.
- [ ] `ADD_SUBTITLE_TRACK` — call `aiClient.generateSubtitles` +
      insert resulting cues onto a new text/subtitle track.
- [ ] `ADD_IMAGE_OVERLAY` — call `aiClient.generateImage` (Phase 8: now
      possibly routed through OpenAI-compatible image gen), then insert
      result as an image element via timeline API (mirror the existing
      `ADD_TEXT_OVERLAY` pattern for track lookup/insert).
- [ ] `ADD_VOICEOVER` — call `aiClient.generateSpeech`/`generateSpeechBlob`,
      insert as audio element.
- [ ] `DENOISE_AUDIO` — call backend `audio_service` denoise endpoint,
      replace/insert resulting audio.
- [ ] `GENERATE_IMAGE` — same as ADD_IMAGE_OVERLAY's generation step but
      without auto-placement (asset-panel insert only, per existing
      action semantics — check `previewAction` wording to confirm intent).
- [ ] `ADD_MUSIC` — call the AI Music Generation backend endpoint
      (locate it under `services/ai-backend/app/routes/generate.py` or
      similar — verify exact route name), insert onto an audio track.
      Phase 9 will add a smarter auto-select variant; this stub fix is
      just wiring the existing manual generation path.
- [ ] `NORMALIZE_AUDIO` — call LUFS normalization backend endpoint.
- [ ] `AUTO_DUCK` — call auto-duck backend endpoint with duck
      amount/fade params.
- [ ] `COLOR_CORRECT` — apply one of the 8 documented color-correction
      profiles via the effects/filter system already used by manual
      color grading UI.
- [ ] `EXPORT_PROJECT` — call export route with format/quality params;
      this one should remain confirmation-gated per the policy in
      AGENT.md even though it's not literally destructive to the
      project (it's slow/resource-heavy and user should approve).

### 4b. Wire existing-but-disconnected backend services as agent tools
- [ ] `silence_service.detect_silences` → expose as a tool the agent can
      call mid-plan (not just the existing manual "Smart Cut" button
      path) — likely needs a new `/api/llm/tools/*` or reuse of
      `/api/analyze/silences`, returning data the LLM can reason over
      before emitting a `REMOVE_SILENCE` action with real timestamps
      instead of guessing.
- [ ] `clip_detector` (multi-signal scoring) → tool for "find best
      clips" goals, feeding into `ADD_CHAPTER_MARKERS` or a new
      `CREATE_CLIP_RANGE` action type.
- [ ] `topic_detector.detect_boundaries` → tool backing
      `ADD_CHAPTER_MARKERS`, replacing any ad-hoc LLM guessing of
      chapter times with the dedicated, already-tested service.
- [ ] `face_reframe.compute_crop_trajectory` → tool backing the
      `AUTO_REFRAME` action type (see Phase 11 — this becomes the
      face-only fallback path when no other detected object is the
      target subject).
- [ ] `subtitle_service` → confirm it's what `ADD_SUBTITLE_TRACK` (4a)
      actually calls, don't reimplement SRT/VTT formatting client-side.

### 4c. Scene/person description tool (moved/expanded — see Phase 6)
This was originally scoped here as a standalone feature; it's now the
core deliverable of Phase 6's ingest pipeline (run automatically per
asset) AND a manually-invokable agent tool (for re-running on demand,
e.g. after a new clip is added mid-edit). Implement the underlying
capability once in Phase 6, expose it as both an automatic pipeline step
and an explicit `DESCRIBE_SCENES` agent action that re-triggers it
on-demand for a specific asset/time range.

## Phase 5 — GoPro / iPhone format compatibility (new)

Goal: footage from GoPro and iPhone cameras imports, previews, and
exports correctly, without the user needing to manually transcode first.

- [ ] Research and document the actual failure modes before writing
      code — don't guess:
      - [ ] iPhone: HEVC (H.265) in `.MOV`, rotation often stored as a
            display matrix in the moov atom rather than baked into pixel
            data (causes sideways/upside-down playback in players that
            ignore the matrix); ProRes and Dolby Vision/HDR variants on
            newer Pro models; `.HEIC` photos if stills are imported too.
      - [ ] GoPro: HEVC or H.264 in `.MP4`; GPMF metadata track
            (telemetry — GPS, gyro, accel) embedded as a non-standard
            stream that some demuxers choke on; high frame rate
            (120/240fps) and variable frame rate in some modes; HDR10+
            on newer models (HERO11+).
      - [ ] Confirm which of these actually break the current pipeline
            (browser `<video>`/WebGL preview, FFmpeg-based export,
            Whisper audio extraction) vs. which already work — test with
            real sample files from both camera types before assuming a
            fix is needed everywhere.
- [ ] Add a new ingest step (likely inside the Phase 6 pipeline, or just
      before it) that:
      1. Probes the uploaded file with `ffprobe` for codec, container,
         rotation matrix, HDR metadata, and frame rate.
      2. If the file is already broadly compatible (H.264 in MP4, no
         problematic rotation matrix, SDR, standard frame rate), skip
         conversion entirely — don't waste time/quality re-encoding
         files that are already fine.
      3. If incompatible, generate a normalized derivative (default: not
         destructive — keep the original, store a converted proxy/
         working copy) using FFmpeg: bake rotation into pixels (or strip
         the display matrix consistently, pick one and document why),
         tone-map HDR→SDR if needed for preview (keep HDR export
         capability separate/optional, don't silently lose HDR data the
         user wanted), and re-mux/transcode codec only if the target
         codec genuinely isn't supported by the preview/export pipeline.
      4. Strip or separately extract the GPMF telemetry track rather
         than letting it break standard demuxing — decide whether GPS/
         telemetry data is worth surfacing anywhere in the UI (e.g. as
         asset metadata) or simply discarded; lean toward capturing it
         into the Phase 6/7 metadata store if cheap to do, since it's
         genuinely useful provenance data (capture location, motion).
- [ ] Add backend route (e.g. `POST /api/video/normalize` or fold into
      the asset-upload route from Phase 6) and surface conversion status
      in the UI (e.g. "Optimizing iPhone footage for editing..." similar
      to existing proxy-generation UX already in the README).
- [ ] Add explicit test fixtures: at least one real (or representative
      synthetic) GoPro HEVC+GPMF sample and one real iPhone HEVC+rotation
      sample, used in an automated or documented manual test, not just
      "should work in theory."
- [ ] Document in AGENT.md exactly what was found to be broken vs. fine,
      replacing the speculative list above with verified facts.

## Phase 6 — Automatic asset ingest pipeline (new)

Goal: the moment a video/audio/image asset is added to a project, it's
automatically run through a standard analysis pipeline — object
detection, scene description, transcript, EXIF/metadata extraction —
so the agent never has to ask the user "what's in this clip?" or wait on
a slow on-demand analysis mid-conversation.

- [ ] Design the pipeline as an async job, not a blocking call on
      upload — asset should be usable in the editor immediately;
      metadata populates as it completes (resolves the "Open question"
      in AGENT.md in favor of async, unless investigation in Phase 0
      re-verification finds a strong reason otherwise).
- [ ] Reuse the existing `job_queue.py` service (Redis-backed per
      docker-compose, with in-memory fallback per README) rather than
      building a second queue system.
- [ ] Pipeline steps per asset (branch by media type — video/audio/
      image — not every step applies to every type):
      1. **Format/EXIF/metadata extraction** — `ffprobe` for video/audio
         (codec, resolution, fps, duration, rotation, HDR flags, camera
         make/model if present in metadata, creation timestamp, GPS if
         present); EXIF library for images (camera make/model, GPS,
         orientation, capture timestamp, lens info). This is cheap and
         should run first/always.
      2. **GoPro/iPhone normalization check** — call Phase 5's
         probe-and-conditionally-convert step here, video assets only.
      3. **Transcript** — run existing Whisper transcription
         (`whisper-service`) automatically for video/audio assets with
         an audio track, instead of waiting for the user to click
         "Transcribe." Store result via existing transcript storage
         (`useTranscriptStore` / whatever backs it persistently — verify
         in Phase 0).
      4. **Object detection** — NEW capability (see "Known architecture
         facts" — no general object detector exists yet). Sample frames
         at a reasonable interval (don't process every frame of a long
         video), run through a chosen detector (YOLOv8/ONNX per the
         user's stated preference — confirm licensing per AGENT.md open
         question before committing), produce a list of
         `{label, confidence, bbox, timestamp}` per asset. This is also
         the foundation for Phase 11's auto-reframe.
      5. **Scene description** — combine object detection output +
         CLIP zero-shot tags (existing `clip-service`) + sampled
         thumbnails, optionally pass through a vision-capable LLM (local
         Kimi-VL via TurboQuant, or an OpenAI-compatible vision model per
         Phase 9) to produce a natural-language description per detected
         scene/cut (reuse client-side color-histogram cut points as scene
         boundaries, per the existing AI Scene Detection feature — don't
         recompute cut detection server-side if the client already has
         it; figure out the right hand-off point).
      6. **Sound/mood signal extraction** — lightweight audio analysis
         (energy, tempo if music is present, speech vs. music vs.
         silence ratio) feeding into Phase 10's auto sound-matching; can
         reuse existing beat-detection/audio-analysis services mentioned
         in the README rather than building new signal processing.
- [ ] Each step writes its result to the Phase 7 persistence layer
      keyed by asset ID, independently — a failure in object detection
      shouldn't block the transcript from being saved, and the UI should
      be able to show partial progress ("Transcript ready, analyzing
      objects...").
- [ ] Surface ingest status in the asset panel UI (small per-asset
      progress indicator) so the user/agent both know what's ready.
- [ ] Expose a unified `GET /api/assets/{id}/metadata` route returning
      everything gathered above in one call, for the agent to consume
      when building project context (ties into Phase 3's context
      injection).
- [ ] Make every step here idempotent and re-runnable on demand (for
      the `DESCRIBE_SCENES`-style manual re-trigger mentioned in 4c, and
      for re-running after a destructive edit changes what's in a clip).

## Phase 7 — Persistence guarantees (new)

Goal: project state — including all Phase 6 derived metadata — survives
restarts, isn't silently lost, and is the system of record (not a cache
that can desync from what's actually on disk/OPFS).

- [ ] Audit current persistence: confirm exactly what's in Postgres
      today (`apps/web/migrations/`) vs. what's only in OPFS/browser
      storage vs. what's only ever in-memory (e.g. confirm whether
      `useTranscriptStore`/`useBackgroundTasksStore` persist anywhere or
      reset on reload — check Zustand store configs for `persist`
      middleware usage).
- [ ] Design schema additions for Phase 6 metadata: per-asset tables for
      transcript, detected objects, scene descriptions, EXIF/metadata,
      ingest job status — linked to existing asset/project IDs, added via
      the existing migrations mechanism (confirm Drizzle vs. raw SQL vs.
      other in Phase 0).
- [ ] Decide and document storage split: structured queryable fields
      (object labels, timestamps, EXIF key/values) → Postgres;
      large blobs (full transcript text, thumbnail images) → either
      inline if small enough or referenced by a stable path/URL into
      existing generated/uploads storage (don't duplicate the OPFS-vs-
      server-disk-vs-Postgres question per feature — pick one pattern
      and apply it consistently across all of Phase 6's outputs).
- [ ] Ensure project save/autosave paths (`save-manager.ts` per the core
      managers list) include the new metadata, not just timeline/track
      state — verify nothing about the existing save flow assumes a
      fixed schema that would silently drop new fields.
- [ ] Add a basic data-integrity check (e.g. on project load, verify
      referenced asset files/metadata actually exist; surface a clear
      "missing asset" state rather than crashing) — this becomes more
      important once more derived state exists to get out of sync.
- [ ] Test: create a project, let ingest pipeline run, restart the full
      docker-compose stack (`docker compose down && docker compose up`),
      reload the project, confirm transcript/objects/scene descriptions/
      EXIF are all still present without re-running ingest.

## Phase 8 — OpenAI-compatible image generation (new)

Goal: image generation (currently via local Stable Diffusion in
`image-service`, per README) can also route through any OpenAI-
compatible image endpoint (e.g. `gpt-image-1` via OpenAI, or other
providers exposing `/images/generations`), same selection pattern as
the Phase 2 LLM backend.

- [ ] Reuse the shared OpenAI-compatible client helper from Phase 2
      (per AGENT.md conventions) rather than writing a new HTTP client.
- [ ] Add backend config: reuse `OPENAI_BASE_URL`/`OPENAI_API_KEY` from
      Phase 2 for auth (same provider account typically covers both
      chat and image endpoints), but allow an independent
      `OPENAI_IMAGE_MODEL` setting since the right model differs from
      the chat model.
- [ ] Add backend selection logic mirroring `model_backend.py`'s pattern:
      a small `image_backend.py` (or extend `diffusion_service.py`) that
      routes to local Stable Diffusion vs. OpenAI-compatible based on
      config, with fallback to local if the remote call fails and local
      is available.
- [ ] Update `generate.py`'s image route and `aiClient.generateImage`
      response handling to be agnostic to which backend served the
      request (consistent response shape already exists per
      `ImageGenResult` — verify it doesn't assume SD-specific fields
      like `seed` are always present, since some hosted APIs won't
      return one).
- [ ] Surface backend choice in Settings (similar UI treatment to
      Phase 2's LLM backend selector).

## Phase 9 — OpenAI-compatible scene description / vision (new)

Goal: Phase 6's scene-description step (and any future vision-dependent
feature) can use an OpenAI-compatible vision model (e.g. `gpt-4o`,
`gpt-4o-mini`, or any vision-capable model behind an OpenAI-compatible
endpoint) instead of requiring local Kimi-VL/TurboQuant.

- [ ] Confirm which OpenAI-compatible providers the user actually has
      vision access to — don't assume every configured provider/model
      supports image input; add a capability flag (config setting or
      a runtime probe) rather than assuming.
- [ ] Extend the shared OpenAI-compatible client helper (Phase 2/8) to
      support multipart/image content parts in chat messages per the
      OpenAI vision API shape (`image_url` content blocks, base64 or
      hosted URL).
- [ ] Wire Phase 6 step 5 (scene description) to pick: OpenAI-compatible
      vision (if configured and capable) → local Kimi-VL via TurboQuant
      (if available) → CLIP-tags-only text description with no LLM
      (graceful degraded fallback, always available) — in that priority
      order, mirroring the Phase 2 fallback pattern.
- [ ] Make sure frame sampling for vision calls is economical — don't
      send every frame of a long video to a paid vision API; sample at
      scene-cut boundaries only (ties back to Phase 6 step 5's reuse of
      client-side cut detection).

## Phase 10 — Auto sound/music selection via Freesound or alternatives (new)

Goal: the agent can pick and insert appropriate background music/SFX
automatically based on content (mood, energy, transcript sentiment),
rather than requiring the user to manually search and choose.

- [ ] Reuse existing Freesound integration
      (`FREESOUND_CLIENT_ID`/`FREESOUND_API_KEY`, search/preview/download
      flow already in the app per README's Sounds panel) as the primary
      backend — call it programmatically from a new agent tool rather
      than reimplementing search/auth.
- [ ] Define the "alternative" path explicitly rather than leaving it
      vague: the existing local **AI Music Generation** feature (15
      genres/12 moods/3 tempos, per README) is the natural fallback when
      Freesound has no API key configured or returns no good match —
      confirm with the user whether that's the intended "other
      alternative" or whether a second external sound-library API
      (e.g. Pixabay Audio, Epidemic Sound API if they have access) is
      wanted instead. Don't build a second integration speculatively.
- [ ] New agent tool: given project context (transcript sentiment/
      energy from Phase 6 step 6, scene mood from Phase 6 step 5, target
      duration), produce a Freesound search query (genre/mood/tempo
      keywords) or, if generating, the existing `ADD_MUSIC` params —
      then auto-select the best result by some simple scoring (license
      compatibility — prefer CC0/CC-BY — duration fit, rating) rather
      than always taking the first hit.
- [ ] Surface the auto-selected track's license/attribution requirement
      to the user if it requires attribution (CC-BY) — don't silently
      insert audio with an attribution obligation the user doesn't know
      about; this is a real legal-exposure detail, not optional polish.
- [ ] New action type `AUTO_SELECT_SOUND` (non-destructive — adds to a
      track, doesn't remove anything) in the Phase 3 action vocabulary.

## Phase 11 — Auto-reframe with object detection (new)

Goal: extend the existing face-only Smart Reframe (`face_reframe.py`,
README's "Smart Reframe") to track and frame non-person subjects (pets,
products, sports action, vehicles, etc.) using Phase 6's object
detection output, not just faces.

- [ ] Depends on Phase 6 step 4 (object detection) existing first —
      sequence this after Phase 6, not in parallel.
- [ ] Extend `face_reframe.py`'s crop-trajectory logic (or add a sibling
      `object_reframe.py` sharing the same `CropRegion`/trajectory
      interpolation code — prefer extending/sharing over duplicating) to
      accept a target subject that may be a face OR a detected object
      class/instance.
- [ ] Subject selection strategy: if the agent/user specifies a target
      ("keep the dog centered", "follow the ball"), match against
      detected object labels; if unspecified, default priority order:
      person/face (existing behavior, don't regress) → largest/most
      central high-confidence object → existing no-subject center-crop/
      Ken-Burns fallback.
- [ ] Handle the multi-subject case consistently with the existing
      multi-face logic (bounding box union; pan between subjects if too
      wide to fit one frame) — reuse that logic's shape rather than
      inventing a different algorithm for objects vs. faces.
- [ ] Keep the existing 4 aspect-ratio presets (9:16, 1:1, 4:5, 16:9)
      and UI entry point (Settings → ... → Smart Reframe per README) —
      this is an enhancement to an existing feature, not a new UI
      surface, unless product wants a separate "object tracking" toggle
      to distinguish from pure face mode (confirm with user if unsure).
- [ ] New/extended action type: either extend the existing reframe
      action with an optional `targetObjectLabel` param, or add
      `AUTO_REFRAME` as a new explicit Co-Pilot action type per Phase
      4b's note — pick one, don't have two competing entry points for
      the same capability.

## Phase 12 — Verification

- [x] Type-check (`bun run typecheck` or equivalent) across `apps/web`.
- [x] Python static checks (`ruff`/`mypy` if configured, else at least
      `python -m py_compile` on touched files) across
      `services/ai-backend` and any new service directories.
- [x] If Docker is available: full `docker compose up`, manually drive:
      - one full Co-Pilot goal end-to-end ("make this a 60s reel with
        captions"),
      - one auto-cleanup goal (silence/filler removal with confirmation
        gating),
      - uploading one GoPro and one iPhone sample clip, confirming
        normalization + full ingest pipeline (transcript, objects, scene
        description, EXIF) completes and persists,
      - a full stack restart to confirm Phase 7 persistence,
      - one auto-reframe run on a non-person subject,
      - one auto sound-selection run, checking attribution surfacing.
- [x] If Docker is not available: clearly state in the final report
      which parts were only statically verified vs. actually executed.
- [x] Update AGENT.md with anything learned that the next session needs
      (new gotchas, anything that turned out different from what's
      documented above) — in particular, replace Phase 5's speculative
      GoPro/iPhone failure-mode list with verified findings, and record
      the final object-detector and persistence-schema choices made.

## Explicit non-goals for this pass
- Not rewriting the existing `command.py` single-shot natural-language
  command path unless Phase 3 decides to deprecate it.
- Not touching the version-control/scenes-manager/merge-engine system
  (`core/managers/scenes-manager.ts` etc.) — unrelated to "scene
  detection" despite the name collision; do not conflate.
- Not adding new third-party video-gen providers beyond what's already
  listed (Runway/Pika/Kling/etc. via Replicate, Seedance, Stability,
  Luma) — out of scope.
- Not building a second external sound-library integration unless the
  user explicitly confirms Freesound + local music generation isn't
  sufficient (see Phase 10 note).
- Not supporting camera formats beyond GoPro/iPhone in this pass (e.g.
  DJI drones, other action cams) — extend later if needed, don't
  generalize prematurely.