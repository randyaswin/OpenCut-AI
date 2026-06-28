# PLAN.md — OpenCut-AI Improvement Project (v2)

Status: NOT STARTED — plan for an agent to execute. Phases 1–8 from the v1 plan are marked done
per `AGENTS.md` v2's "Carried-over status" section. Phases 9–11 from v1 were defined but, per
last audit, not confirmed executed in code — they are **re-included below, unchanged in scope**,
just resequenced so this document is the single source of truth going forward. New phases start
at 12.

Read `REVIEW.md` first for the reasoning behind prioritization.

## Phase 0 — Setup & re-verification

- [ ] Create a feature branch.
- [ ] Read `AGENTS.md` (v2) fully, then the original v1 content it carries forward.
- [ ] Re-verify against current `main` (don't trust prior audit blindly — it may be stale):
  - [ ] Grep `ai-action-executor.ts` for every action type listed as a "stub" in AGENTS.md.
        Produce an actual current list of what's stubbed vs. implemented — this determines the
        real scope of Phase 13 below.
  - [ ] Confirm whether `command.py`'s vocabulary and `EditorActionType` have been reconciled
        since v1, or still diverged.
  - [ ] Confirm whether Phase 9 (Freesound auto-select) and Phase 10/11 (object-detection-based
        reframe) from v1 have any partial implementation already, vs. fully unstarted.
  - [ ] Confirm the OpenAI-compatible LLM backend (v1 Phase 2) is genuinely live and selectable,
        not just scaffolded.

---

## Phase 9 (carried from v1) — Auto sound/music selection via Freesound

Goal: the agent can pick and insert appropriate background music/SFX automatically based on
content (mood, energy, transcript sentiment), rather than requiring the user to manually search.

- [ ] Reuse existing Freesound integration (`FREESOUND_CLIENT_ID`/`FREESOUND_API_KEY`,
      search/preview/download flow) as primary backend — call it programmatically from a new
      agent tool, don't reimplement search/auth.
- [ ] Confirm fallback path: local AI Music Generation (15 genres/12 moods/3 tempos) when
      Freesound has no key configured or no good match. Don't build a second external
      integration speculatively.
- [ ] New agent tool: given project context (transcript sentiment/energy, scene mood, target
      duration), produce a Freesound search query or local-generation params, then auto-select
      by simple scoring (license — prefer CC0/CC-BY — duration fit, rating).
- [ ] Surface license/attribution requirement to the user when a CC-BY track is auto-selected —
      this is a real legal-exposure detail, not optional polish.
- [ ] New action type `AUTO_SELECT_SOUND` (non-destructive) in the action vocabulary, following
      the unification work from Phase 14 if that lands first — otherwise add to both
      vocabularies with an explicit TODO to merge.

## Phase 10 (carried from v1) — Auto-reframe with object detection

Goal: extend the existing face-only Smart Reframe (`face_reframe.py`) to track non-person
subjects (pets, products, sports action, vehicles) using the ingest pipeline's object detection
output.

- [ ] Confirm object detection output schema (`{label, confidence, bbox, timestamp}` per v1) is
      stable and queryable per-asset before building on it.
- [ ] Extend `face_reframe.py`'s crop-trajectory logic (or add a sibling `object_reframe.py`
      sharing the same `CropRegion`/interpolation code — prefer extending/sharing) to accept a
      target subject that may be a face OR a detected object class/instance.
- [ ] Subject selection: if specified ("keep the dog centered"), match against detected labels;
      if unspecified, priority order: person/face (existing, don't regress) → largest/most
      central high-confidence object → existing center-crop/Ken-Burns fallback.
- [ ] Handle multi-subject case consistently with existing multi-face logic (bbox union, pan if
      too wide) — reuse shape, don't invent a parallel algorithm.
- [ ] Keep existing 4 aspect-ratio presets and UI entry point — this is an enhancement, not a
      new UI surface, unless product wants a separate toggle to distinguish from pure face mode.
- [ ] Extend the existing reframe action with an optional `targetObjectLabel` param, or add
      `AUTO_REFRAME` as a distinct action type — pick one, don't have two competing entry points.

## Phase 11 (carried from v1) — Verification of v1 carryover work

- [ ] Type-check (`bun run typecheck`) across `apps/web`.
- [ ] Python static checks (`ruff`/`mypy`, else `python -m py_compile`) across
      `services/ai-backend` and any touched service directories.
- [ ] If Docker available: drive one Freesound auto-select goal end-to-end, one non-face
      auto-reframe run, confirm both persist correctly per Phase 7 (v1) persistence guarantees.
- [ ] If Docker not available: state clearly what was only statically verified.
- [ ] Update `AGENTS.md` with anything learned.

---

## Phase 12 — Close the action-executor stubs (HIGHEST PRIORITY, blocks everything else's value)

Goal: every action the Co-Pilot can plan, it can actually run. This is prioritized above new
features deliberately — an agent that plans well but executes a `console.warn` is not "maximal"
no matter what's added on top.

- [ ] For each action confirmed still-stubbed in Phase 0's re-verification, implement against
      real timeline/backend APIs:
  - [ ] `TRIM_CLIP` — timeline trim API on the matching element.
  - [ ] `ADD_TRANSITION` — timeline transition-insert API; verify against the 20 documented
        transitions.
  - [ ] `ADD_SUBTITLE_TRACK` — `aiClient.generateSubtitles` + insert cues onto a new track;
        confirm this calls `subtitle_service.py`, doesn't reimplement SRT/VTT formatting.
  - [ ] `ADD_IMAGE_OVERLAY` — `aiClient.generateImage` → insert as image element (mirror
        `ADD_TEXT_OVERLAY` pattern for track lookup/insert).
  - [ ] `ADD_VOICEOVER` — `aiClient.generateSpeech`/`generateSpeechBlob` → insert as audio.
  - [ ] `DENOISE_AUDIO` — backend `audio_service` denoise endpoint → replace/insert result.
  - [ ] `GENERATE_IMAGE` — generation only, asset-panel insert (no auto-placement) — confirm
        intent against `previewAction` wording.
  - [ ] `ADD_MUSIC` — call existing AI Music Generation backend route, insert onto audio track.
  - [ ] `NORMALIZE_AUDIO` — call LUFS normalization backend endpoint.
  - [ ] `AUTO_DUCK` — call auto-duck backend endpoint with duck amount/fade params.
  - [ ] `COLOR_CORRECT` — apply one of the 8 documented profiles via existing effects/filter
        system.
  - [ ] `EXPORT_PROJECT` — call export route with format/quality params; keep
        confirmation-gated (slow/resource-heavy, not "destructive" in the data-loss sense, but
        still needs explicit go-ahead).
- [ ] For any action NOT in the original v1 stub list but discovered stubbed during Phase 0
      re-verification, add it to this checklist before closing this phase — don't let newly
      discovered stubs slip through unaddressed.
- [ ] Every implementation here gets a minimal manual test (or automated, if a test harness
      exists) demonstrating it actually changes the timeline/project state, not just that it
      doesn't throw.

## Phase 13 — Unify the two action vocabularies

Goal: stop `EditorActionType` (Co-Pilot) and `command.py`'s vocabulary (`cut`, `trim`, `delete`,
`add_text`, etc.) from drifting further apart.

- [ ] Document the current full mapping: which `command.py` verbs have no `EditorActionType`
      equivalent and vice versa.
- [ ] Decide (don't relitigate endlessly — pick one): either (a) deprecate `command.py`'s
      vocabulary in favor of routing all single-shot natural language commands through the
      Co-Pilot's action set with a lightweight "single action, no plan needed" fast path, or
      (b) keep `command.py` for genuinely fast single-shot edits but implement it as a thin
      adapter that maps onto `EditorActionType` under the hood, so there's one source of truth
      for what an action *does*, even if there are two entry points for *invoking* it.
      Recommendation: (b) — preserves the fast single-command UX while eliminating duplicate
      execution logic.
- [ ] Implement the chosen adapter/deprecation.
- [ ] Add a regression check (manual or automated) confirming a sampled set of commands produce
      identical timeline results whether invoked via `/api/llm/command` or the Co-Pilot path.

## Phase 14 — Granular observation tools for the agent

Goal: the agent can inspect specific moments instead of reasoning only from ingest-time
summaries.

- [ ] `GET_FRAME_AT(assetId, timestamp)` — server-side frame extraction (reuse the proxy/
      thumbnail generation pipeline's frame-sampling code, don't write a second extractor),
      returned as an image content part for vision-capable backends (reuses Phase 9's v1
      OpenAI-compatible vision wiring, or local Kimi-VL).
- [ ] `GET_TRANSCRIPT_RANGE(assetId, startMs, endMs)` — read from the existing persisted
      transcript store (Postgres-backed per v1 Phase 7), word-level if available.
- [ ] `GET_CLIP_NEIGHBORS(clipId)` — returns the clips immediately before/after on the same
      track, with their key metadata (duration, detected objects, scene description summary).
- [ ] Add all three to the agent loop's tool registry (`agent-loop.ts`) alongside the existing
      `LIST_MEDIA`/`GET_MEDIA_METADATA`/`GET_TIMELINE_STATE` tools, following the same calling
      convention.
- [ ] Update the system prompt to explain when the agent should reach for these vs. relying on
      ingest-time summary context — e.g. "use `GET_FRAME_AT` when the user references a specific
      visual moment you don't have a pre-computed description for."
- [ ] Cap usage sensibly (e.g. don't let the agent sample more than N frames per plan without
      good reason) to control latency/cost — mirror the frame-sampling economy principle from
      v1 Phase 9 (vision calls sampled at scene-cut boundaries, not every frame).

## Phase 15 — Batch operation primitive

Goal: "clean up the whole video" goals don't require N separate confirmations for N clips.

- [ ] Define a new action shape: `BATCH_ACTION { matchCriteria, action, params }` where
      `matchCriteria` can reference output from a query tool (e.g. all segments returned by
      `silence_service.detect_silences`, or all clips tagged with a given object label).
- [ ] Executor behavior: resolve `matchCriteria` to a concrete list of targets, then — if the
      underlying `action` is destructive — show the **full resolved list** (not just a count) in
      a single confirmation step before executing any of them. Non-destructive batch actions
      auto-execute as today.
- [ ] Allow the user to deselect individual items from the resolved list before confirming
      (UI checkbox list in the plan step), not just accept/reject the whole batch.
- [ ] Apply this first to the two most common batch goals: "remove all filler words/silences in
      the video" and "apply transition X to every cut" — use these as the first real test cases
      before generalizing further.
- [ ] Update the system prompt to prefer `BATCH_ACTION` over emitting N individual steps when a
      goal is naturally a "do this everywhere" request.

## Phase 16 — Template-aware planning

Goal: goal-described requests can start from one of the 8 existing templates instead of building
a timeline from zero.

- [ ] New query tool `LIST_TEMPLATES` — returns the existing 8 templates with their metadata
      (category, aspect ratio, typical use case) from the existing template gallery data source.
- [ ] New action `APPLY_TEMPLATE(templateId)` — calls the existing one-click apply mechanism
      already used by the manual Template Gallery UI; don't reimplement template application
      logic, just expose the existing path as a callable agent action.
- [ ] Update the system prompt: when a goal closely matches a template's stated use case (e.g.
      "make this a TikTok vlog" → TikTok Vlog template), the agent should consider proposing
      `APPLY_TEMPLATE` as the first plan step, then layering specific edits on top, rather than
      always building from a blank timeline.
- [ ] This is non-destructive only when applied to a new/empty project; if applied to a project
      with existing timeline content, treat as destructive (it likely resets timeline structure)
      and gate accordingly — verify actual template-apply behavior on a non-empty project before
      deciding the gate, don't assume.

## Phase 17 — Auto-translate + auto-dub pipeline

Goal: translate the transcript and generate a dubbed voiceover in the target language, as one
agent-drivable pipeline. Composes existing transcription + LLM + TTS, no new core service.

- [ ] New backend step: `translate_transcript(segments, targetLanguage)` — calls the existing
      LLM backend (`model_backend.generate_json`) with a translation prompt per segment (or
      batched, whichever proves more reliable for timing-faithful output), preserving segment
      timing boundaries so the dub can be re-synced to the original cut points.
- [ ] Decide and document: translate per-segment independently (faster, parallelizable, risk of
      losing cross-segment context) vs. whole-transcript-then-resegment (better fluency, harder
      to keep timing aligned). Recommend per-segment with surrounding-segment context included
      in the prompt for continuity, re-evaluate if quality is poor in testing.
- [ ] New backend step: for each translated segment, call existing TTS (Sarvam/Smallest/XTTS)
      with the target language and either the cloned original voice (if voice cloning is
      enabled/configured) or a default voice for that language.
- [ ] Handle duration mismatch: translated speech rarely matches the original segment's exact
      duration. Decide a strategy — time-stretch the generated audio within a tolerance band
      (e.g. ±15%) before falling back to either trimming silence or accepting drift — document
      the chosen tolerance and fallback in `AGENTS.md` once decided, since this is a real
      product-quality tradeoff, not a pure implementation detail.
- [ ] New action type `AUTO_DUB(targetLanguage, voiceMode)`. Default behavior: add as a new
      alternate audio track (non-destructive, switchable) rather than replacing the original
      track — per the confirmation-policy extension in `AGENTS.md` v2.
- [ ] Surface translated captions alongside the dub (reuse existing subtitle track mechanism) —
      don't generate audio-only dubs without the option to also burn in translated captions.
- [ ] Test with at least 2 language pairs end-to-end (e.g. English→Indonesian and
      English→Japanese, given the project's existing multilingual context) before considering
      this phase done.

## Phase 18 — Auto-cut-to-beat

Goal: generate cut points aligned to detected beats, as one agent action, reusing existing beat
detection — not building new audio analysis.

- [ ] Confirm exact output shape of existing beat detection (BPM, beat timestamps, beat
      strength) before building on it — re-derive nothing that's already computed.
- [ ] New backend/agent logic: given a target track's beat timestamps and the video clips
      available on the timeline, generate a cut-point list that aligns clip boundaries to beats
      within a configurable snap tolerance (e.g. snap to nearest beat within 80ms, otherwise
      leave the cut where it is rather than forcing a bad snap).
- [ ] New action type `AUTO_CUT_TO_BEAT(trackId, snapToleranceMs)`. This is destructive (it
      moves/splits existing clip boundaries) → confirmation-gated, showing the proposed new cut
      points relative to current ones before applying.
- [ ] Provide a preview mode (show the beat grid + proposed cut points overlaid on the timeline
      before committing) — reuse the existing beat-grid visualization toggle mentioned in the
      README rather than building a new overlay.

## Phase 19 — Cross-clip color match

Goal: "make clip B match clip A's look" as an AI action, distinct from applying a static preset.

- [ ] New backend step: sample color statistics (histogram, average color temperature/tint,
      luminance distribution) from a reference clip (or a specific frame range within it).
- [ ] New backend step: compute a correction (LUT-like transform or parameterized
      adjustment — reuse whatever representation the existing 8 color-correction profiles
      already use, don't invent a second color-transform representation) that shifts the target
      clip's stats toward the reference's.
- [ ] New action type `MATCH_COLOR(referenceClipId, targetClipId | targetClipIds[])`.
      Non-destructive if applied as a new effect layer (consistent with how the existing preset
      system applies corrections) → should auto-execute, no confirmation needed, matching the
      precedent for `COLOR_CORRECT`.
- [ ] Validate visually on at least one real multi-camera-source test case (e.g. two clips shot
      on different devices with visibly different white balance) before considering this done —
      a color match that "computes successfully" but looks wrong is not done.

## Phase 20 — AI B-roll suggestion/insertion from transcript

Goal: detect segments that are visually static/talking-head-heavy relative to their narrative
content, and suggest or generate relevant cutaway B-roll.

- [ ] New backend logic: identify candidate segments using existing signals already computed by
      the ingest pipeline — low scene-cut frequency over a sustained duration + transcript
      content available for that range (don't build new "boring-ness" detection from scratch;
      compose: scene-description sameness + silence/energy + transcript topic).
- [ ] For each candidate segment, derive a short content query from the transcript text in that
      range (via the existing LLM backend) suitable for either (a) a stock/generated visual
      search or (b) a prompt to the existing AI Video Generation Hub.
- [ ] Decide source priority order and document it: existing AI Video Generation Hub (9 models/
      5 providers, already integrated) as the primary path since no stock-footage library
      integration exists yet (per `REVIEW.md`, that's a separate, lower-priority gap) →
      generated B-roll is therefore the only available source in this phase; don't block this
      phase on adding a stock library too.
- [ ] New action type `SUGGEST_BROLL(segmentRange)` (non-destructive — proposes options, doesn't
      auto-insert) and `INSERT_BROLL(segmentRange, selectedOption)` (non-destructive if inserted
      as an overlay/cutaway track rather than replacing the talking-head footage; confirm this
      is in fact how cutaways are conventionally inserted in this editor's track model before
      assuming).
- [ ] Surface generation cost/time estimate before generating, per the `requiresCostConfirmation`
      pattern defined in `AGENTS.md` v2, since this calls metered video-gen APIs.

## Phase 21 — Quick-win effects: reverse / loop / boomerang

Goal: low-effort, frequently-used short-form effects, bundled together since they're all simple
FFmpeg/WebGL operations on a single clip.

- [ ] `REVERSE_CLIP` — FFmpeg `-vf reverse` (and `-af areverse` if audio should also reverse;
      decide default — likely audio-off or also-reversed depending on UX expectation, confirm
      with existing speed-ramp/freeze-frame UX conventions) applied to a duplicated clip, not
      in-place (non-destructive).
- [ ] `LOOP_CLIP(count | targetDuration)` — repeat a clip's content to fill a duration or N
      repetitions; check whether this should be a render-time effect (cheaper) or an actual
      timeline duplication (simpler to reason about, more storage) — prefer render-time if the
      existing transform/effect pipeline supports duration-changing effects, else duplication.
- [ ] `BOOMERANG_CLIP` — forward-then-reverse-then-loop-point composition of the above two
      primitives; implement as a composition, don't write a third bespoke FFmpeg pipeline.
- [ ] All three are non-destructive (operate on a copy/new derived clip) → auto-execute.
- [ ] Add as new action types; wire into both the manual UI (a small effects menu addition, even
      if minimal) and the agent action vocabulary, so the agent can invoke them when a user
      says e.g. "make this a boomerang."

## Phase 22 — Per-word animated caption presets

Goal: extend existing subtitle styling (karaoke/pill/classic) with animated text presets common
in CapCut (pop-in, bounce, typewriter reveal) at the per-word/per-character level.

- [ ] Audit the existing subtitle rendering path (likely WebGL or canvas-based, given the
      editor's existing transition/effect shader pattern) to confirm where per-word timing data
      already exists (word-level Whisper timestamps are already captured per the ingest
      pipeline) — this phase is adding animation curves on top of timing data that already
      exists, not adding new timing extraction.
- [ ] Implement 2–3 initial presets (pop-in scale+fade, typewriter reveal, simple bounce) as
      keyframe-generating functions that take per-word start/end times and emit the same kind of
      transform keyframes the existing speed-ramp/motion-tracking systems already use — reuse
      that keyframe representation, don't add a parallel animation system.
- [ ] Add preset selection to the existing subtitle styling UI (alongside karaoke/pill/classic)
      and to the `ADD_SUBTITLE_TRACK` action's params so the agent can select a preset based on
      content tone (e.g. energetic content → bounce, tutorial → typewriter) if asked, or default
      to the existing static style if the user doesn't specify.

## Phase 23 — AI background removal without a green screen

Goal: add real subject/background segmentation (matting), the one gap in this plan that requires
genuinely new model infrastructure rather than recombination. Sequenced last among feature work
deliberately — confirm Phases 12–22 land first since several reuse patterns (new microservice
shape, non-destructive-by-default convention) are easier to follow once established elsewhere.

- [ ] Research model options before committing (don't default to the first name that comes to
      mind): video matting models suited to running without a GPU-heavy footprint, given this
      project's stated CPU-friendly self-hosting goals — e.g. lightweight RVM (Robust Video
      Matting) or MODNet-class models; check license terms (must be compatible with this
      project's MIT license and self-hosting story — avoid anything with a non-commercial-only
      license) and real-world CPU inference speed before choosing. Document the choice and why
      in `AGENTS.md` once decided.
- [ ] New microservice (e.g. `matting-service`) following the existing per-service Dockerfile +
      `requirements.txt`/`requirements.lock` (`uv pip compile --universal`) pattern — model this
      on `face-service`'s structure as the closest existing analog (small, focused CV model
      service), including platform-pinning if the chosen model lacks aarch64 Linux wheels.
- [ ] New backend route (e.g. `POST /api/video/remove-background`) accepting a clip reference
      and optional output mode (transparent/alpha output for compositing vs. flat replacement
      background color/image/video).
- [ ] Output as a new derived asset (matted version) rather than overwriting the original —
      non-destructive by default, consistent with every other derived-asset pattern in this
      project (GoPro normalization, proxy generation).
- [ ] New action type `REMOVE_BACKGROUND(clipId, replacementMode, replacement?)`.
      Non-destructive (produces a new layer/asset) → auto-execute, matching the pattern for
      other generation-style actions, though flag with `requiresCostConfirmation`-equivalent
      compute-time warning if running on CPU is expected to be slow for the clip's duration (this
      is genuinely the most compute-heavy new feature in this plan; be honest about expected
      runtime in the UI rather than letting it silently hang).
- [ ] Add a resource-cost note to the README's existing "What Uses Resources" / "Self-Hosting
      Costs" tables once real benchmark numbers exist from testing — don't guess at numbers in
      the README ahead of actually measuring on representative hardware.
- [ ] Test against at least 3 real clips with varied complexity (clean single subject,
      multi-person, fast motion) before considering this done — matting quality varies a lot by
      scene complexity and this needs honest verification, not a single happy-path test.

---

## Phase 25 — Binary rendering migration (preview/export parity)

Goal: replace the current DOM/CSS-based preview renderer with a single binary rendering path
shared by preview and export, eliminating the class of bugs where what the user sees in preview
doesn't match what comes out of export — and improving preview performance/quality along the
way (frame-accurate scrubbing, real effects in preview instead of CSS approximations, GPU-backed
compositing instead of layout/paint).

**Context that changes the shape of this phase**: the upstream project this repo is forked from
(`OpenCut-app/OpenCut`) is doing exactly this migration right now, and has already landed real
infrastructure for it — a `scene-builder.ts` (flat timeline → hierarchical `BaseNode` tree,
track-ordered), a Rust/wgpu compositor compiled to WASM (`opencut-wasm`, exposed via
`WasmCompositor` in `apps/web/src/services/renderer/compositor/wasm-compositor.ts`) that handles
GPU-side effects (blur, color grading, masking) with texture caching and explicit GPU memory
management, and a `SceneExporter` that drives that *same* compositor frame-by-frame for export,
feeding frames into MediaBunny for muxing. Upstream's own contributor guidance currently asks
contributors to **avoid** preview/export enhancement work because it's mid-migration to this
binary approach. Given this, **do not design a parallel/independent binary renderer from
scratch** — this phase is about determining how much of upstream's work already exists in this
fork (it's a fork of `Ekaanth/OpenCut-AI`, which forked from `OpenCut-app/OpenCut` at some point
in the past — the fork point matters a lot here) and either syncing/porting it in, or building
the same shape of solution if the fork predates that work and a clean upstream merge isn't
practical.

- [ ] **Determine fork lineage and drift first** (this decides everything else in this phase):
  - [ ] Identify which upstream commit/tag `Ekaanth/OpenCut-AI` (and therefore this fork) branched
        from, and compare it against upstream's current `main` to see whether the
        `scene-builder.ts` / `BaseNode` / `WasmCompositor` / `SceneExporter` files described above
        exist anywhere in this fork's history (even if since modified or removed) or never
        existed because the fork predates them.
  - [ ] Check whether upstream is mid-*rewrite* (note: upstream's GitHub README mentions a
        separate ground-up rewrite at `new.opencut.app` with a Rust-core/plugin architecture,
        distinct from the classic version at `opencut-app/opencut-classic`) — confirm which
        upstream lineage (classic vs. rewrite) is actually the one this fork descends from, since
        the binary-rendering work described above belongs to the *classic* line per current
        evidence, not the ground-up rewrite. Don't assume; verify against actual commit history.
  - [ ] Based on the above, classify into one of two paths and proceed accordingly:
    - **Path A (fork already has or can cleanly merge the upstream WASM compositor work)**:
      proceed to the "Port/sync" track below.
    - **Path B (fork has diverged too far — e.g. this fork's AI features touch the same files,
      or the fork predates this work and a clean merge isn't realistic)**: proceed to the
      "Build in place" track below, but follow the *same architecture shape* upstream already
      validated (don't reinvent the node-tree/compositor split) rather than designing something
      novel.
  - [ ] Document the lineage finding and chosen path explicitly in `AGENTS.md` once determined —
        this is a foundational fact the next agent session must not have to re-derive.

- [ ] **Port/sync track (Path A)**:
  - [ ] Pull in (via merge, cherry-pick, or manual port — choose based on how much this fork's
        AI-specific code touches the same renderer files) upstream's `scene-builder.ts`,
        `nodes/` (BaseNode, RootNode, and sibling node types), `compositor/` (WasmCompositor,
        types), `resolve.ts`, `gpu-renderer.ts`, and `scene-exporter.ts`, plus the `rust/` crate
        tree (`compositor`, `effects`, `masks`, `gpu`, `time`) and its WASM bindings.
  - [ ] Reconcile this fork's AI-specific renderer touchpoints (anything Phase 4/12 of this plan
        wired into export, e.g. `EXPORT_PROJECT`'s action implementation, or any AI feature that
        currently manipulates the DOM-based preview directly — e.g. Smart Reframe preview,
        Chroma Key preview, Speed ramping preview, Motion Tracking preview, per the README's
        feature list) against the new node-tree model. Each of these needs to become a node type
        or a property on an existing node type in the new system, not a DOM/CSS hack layered on
        top of it.
  - [ ] Verify the ported compositor builds and runs in this fork's Docker/build setup (it's a
        Rust→WASM toolchain dependency that doesn't exist in this fork's current build pipeline —
        confirm `wasm-pack`/`wasm-bindgen` or whatever upstream uses is added to build tooling,
        CI, and Dockerfiles as needed).

- [ ] **Build in place track (Path B)** — only if Path A is genuinely impractical:
  - [ ] Build the same three-layer shape upstream validated: (1) a scene-graph builder that
        converts the flat timeline model into a hierarchical node tree ordered by track/z-index;
        (2) a GPU-backed compositor (WebGL2 is an acceptable first step if Rust/WASM/wgpu is too
        large a lift for this fork's team/timeline — but design the interface so it can be
        swapped for a WASM compositor later without touching the node tree or call sites); (3) an
        exporter that walks the *same* node tree and drives the *same* compositor frame-by-frame,
        differing from the live preview loop only in clock-driving (manual frame stepping vs.
        real-time playback) and output sink (encoder vs. screen).
  - [ ] Implement texture/resource caching analogous to upstream's `contentHash`-based skip logic
        for redundant uploads, and explicit GPU resource release on node removal — these aren't
        optional polish, they're why the current DOM approach's performance ceiling exists in the
        first place; skipping them reproduces the same problem in a new technology.
  - [ ] Re-implement each existing visual feature (the 20 transitions, 22 filter presets, 12
        effects, masks, Smart Reframe, Chroma Key, Motion Tracking, speed ramping's visual
        preview, multicam viewer) as compositor passes or node properties — treat this as a
        checklist; nothing should regress silently. Cross-reference against the README's full
        "Professional Editing" and "AI-Powered Editing" feature lists before considering this
        track done.

- [ ] **Regardless of path — integration points specific to this fork's AI features** (these
  don't exist upstream and need explicit attention either way):
  - [ ] `EXPORT_PROJECT` (Phase 12 of this plan) must call into the new exporter, not the old
        DOM-based one, once this phase lands — coordinate sequencing with Phase 12 if both are
        in flight; whichever lands second should be the one that does the wiring, recorded
        explicitly in whichever phase finishes first so it isn't dropped.
  - [ ] `GET_FRAME_AT` (Phase 14 of this plan, agent observation tool) should be implemented
        against the new renderer's frame-stepping capability once available — a binary renderer
        that can render an arbitrary timestamp on demand is a *better* foundation for this tool
        than extracting frames from source video files directly, since it reflects the actual
        composited result (with effects/transforms applied), not just the raw source. Sequence
        Phase 14 to depend on this phase if both are scheduled together, or implement Phase 14
        against raw source frames first and upgrade it once this phase lands — document which
        was chosen.
  - [ ] Smart Reframe, Auto-Reframe (Phase 10), and Motion Tracking all currently generate
        transform/crop keyframes that something has to actually *render* — confirm the new
        compositor's transform pipeline consumes these keyframes in the same shape the AI
        features already produce them, or adjust the AI feature output format, but don't let
        two incompatible keyframe shapes exist.

- [ ] **Rollout strategy**: this is a large, risky migration touching the most user-visible part
  of the editor. Land it behind a feature flag (consistent with how this fork's other risky
  changes should be gated — check Phase 0/general conventions for the existing flag mechanism,
  if any, or establish one) so preview can be toggled between old DOM rendering and new binary
  rendering during development and early testing, rather than a single hard cutover.
- [ ] Define explicit parity test criteria before declaring this phase done: for a fixed test
  project exercising most visual features (transitions, filters, effects, masks, text, multiple
  tracks, at least one AI-generated reframe), the exported video and a frame-by-frame capture of
  the live preview at the same timestamps must be visually equivalent (allow for reasonable
  compression artifacts in the export, but layout/effect/timing must match exactly). Automate
  this comparison if feasible (pixel-diff against a tolerance), or document a clear manual
  comparison procedure if not.
- [ ] Performance check: measure preview frame time (or FPS during scrubbing/playback) before
  and after, on both a CPU-only and a GPU-available test machine, for a moderately complex
  project (multiple tracks, at least one active effect). The whole point of this migration is
  performance and consistency — measure both, don't assume either improved just because the
  architecture changed.

## Phase 26 — Adopt Custom's MCP tool vocabulary and skill-loading system

Goal: this fork's agent currently has a narrow, partially-stubbed action vocabulary (Phase 12)
and no formal skill-loading system. A reference competitor product, Custom, exposes its editor to
an AI agent via ~50 granular MCP tools plus a `loadSkill` mechanism that returns step-by-step
guidance before multi-step workflows (captioning, masking, time-remapping, motion graphics,
etc.). This phase ports that full tool vocabulary into this fork's agent action system, and
introduces an equivalent skill-loading system — both adapted to this codebase's actual
architecture, not copied verbatim where the underlying systems differ (e.g. this fork has no
React/Remotion motion-graphics renderer yet; that has to be built, not just wired).

This is a large phase. It's broken into sub-phases (26a–26h) so it can be checkpointed — land
and verify each sub-phase before starting the next, rather than attempting all of it as one
unreviewable change.

### Reference material

Two source documents define the target tool/skill shape exactly (verbatim tool descriptions,
parameters, and skill associations) — read both in full before starting any sub-phase below:
- `custom-mcp-tool-list-original.md` — ~50 tool definitions with exact parameters.
- `custom-skills-reference-original.md` — skill-to-tool associations and the guidance each skill
  is meant to return.

Treat these as the *target shape* to adapt, not a spec to copy 1:1 — Custom's underlying engine,
ID system (`agentId`/`agentIds`, e.g. `video_1_1`), and asset model differ from this fork's. Each
sub-phase below calls out where adaptation (not verbatim porting) is required.

### Foundational decisions before any tool work (do this first, in 26a)

- [ ] **Decide this fork's `agentId` scheme.** Custom's IDs encode type + hierarchy (`video_1`,
      `video_1_1` for a sub-clip, `vignette_1` for an effect instance, `motionGraphic_1`).
      Determine whether this fork's existing timeline element IDs can be adapted to this scheme
      or whether a mapping layer is needed (e.g. internal UUID ↔ stable human-readable agent ID
      for agent-facing tool calls). This decision affects every tool below — get it right once,
      don't let each tool invent its own ID convention.
  - [ ] Document the chosen scheme in `AGENTS.md` once decided.
- [ ] **Decide the skill storage mechanism**: a new directory of per-skill markdown files (e.g.
      `services/ai-backend/app/skills/*.md`), loaded on demand by a new `loadSkill` tool/action,
      mirroring Custom's pattern exactly — skills are NOT injected into the system prompt by
      default; they're fetched only when the agent calls `loadSkill(skillName)` at the start of a
      relevant multi-step workflow. This keeps the default system prompt lean and matches the
      token-efficiency rationale behind Custom's own design (per `custom-skills-reference-
      original.md`'s framing: skills carry "step-by-step guidance you MUST follow" loaded
      on-demand, not always-on context).
  - [x] **Skill content for all 13 skills is already written and provided** (`/skills/*.md` in
        this plan's accompanying files: `captioning-text.md`, `masking.md`,
        `masking-and-shapes-smart-masking.md`, `masking-and-shapes-shapes.md`,
        `time-remapping.md`, `transitions.md`, `audio-sync.md`, `transcript-cleanup.md`,
        `motion-graphics.md`, `long-form-edit.md`, `vlog.md`, `keyframing.md`,
        `assembly-layouts.md`). These are written as final, agent-facing instructional content
        (the actual prose `LOAD_SKILL` should return) — not a stub or outline to be expanded
        later. **Action for this checklist item is now just placement and wiring**, not
        authoring:
    - [ ] Copy these files verbatim into the chosen storage location (e.g.
          `services/ai-backend/app/skills/`), preserving filenames (map
          `masking-and-shapes/smart-masking` and `masking-and-shapes/shapes` skill *names* to
          the hyphenated filenames above, or rename the files to match whatever slash-containing
          or nested-path skill-name convention the `LOAD_SKILL` tool ends up using — just keep
          the name→file mapping consistent and documented).
    - [ ] Each file references this fork's `EditorActionType`/Phase 26 action names directly
          (e.g. `CREATE_MASK`, `WRITE_KEYFRAMES`) rather than Custom's camelCase tool names — verify
          during Phase 26's later sub-phases that the action names actually implemented match
          what these skill files reference; if a sub-phase ends up naming an action differently
          than assumed here, update the corresponding skill file rather than leaving a mismatch.
    - [ ] Skim each file once during implementation of its corresponding sub-phase (26c↔
          captioning-text, 26e↔masking/smart-masking/shapes, 26f↔keyframing, 26g↔time-remapping/
          transitions/audio-sync/transcript-cleanup, 26h↔motion-graphics, 26b↔long-form-edit,
          long-form-edit+vlog↔vlog, 26b/new↔assembly-layouts) to confirm the guidance still
          matches what was actually built — these were written against the *planned* tool shapes
          in `custom-mcp-tool-list-original.md`/`custom-skills-reference-original.md`, adapted to
          this fork's action names; if implementation deviated from the plan anywhere, the skill
          file's specific claims (parameter names, units, limits) need a matching update, not
          just the code.
  - [x] **The `LOAD_SKILL` routing overview is also already written**
        (`skills/_LOAD_SKILL_overview.md`, provided alongside the 13 skill files). This is
        **categorically different from the 13 skill files** and must be handled differently:
    - The 13 skill files are fetched **on demand only** — never part of default agent context.
    - `_LOAD_SKILL_overview.md`'s content is the **opposite** — it must be part of the
      `LOAD_SKILL` tool's own registered `description` field (which the agent always sees,
      since tool descriptions are always in context) and/or referenced from the system prompt's
      skill-routing instruction. Without this routing text being always-visible, the agent has
      no way to know *which* `skillName` to pass to `LOAD_SKILL` without having already loaded
      every skill to find out — defeating the entire token-efficiency point of the on-demand
      design.
    - [ ] Use `_LOAD_SKILL_overview.md`'s "Tool registration text" section verbatim as the
          `LOAD_SKILL` tool's `description` field.
    - [ ] Use its "Routing table" and "Multi-skill workflows" sections as the source for the
          system prompt's skill-routing instruction (condense if the system prompt has tight
          length constraints, but don't drop the multi-skill-workflow guidance — that's the part
          most likely to prevent an agent from under-loading skills on compound requests).
    - [ ] Keep this file in sync with the actual list of 13 skills if any are added/renamed
          later — per that file's own "Maintenance note," letting the routing table and the
          live tool description drift apart recreates the vocabulary-drift problem Phase 13
          fixed elsewhere.
  - [ ] New backend route or direct file-read (depending on where the agent loop runs) serving
        skill content by name — simple file lookup, no need for a database table for this.
  - [ ] New agent tool `LOAD_SKILL(skillName)` registered in the agent loop's tool registry
        alongside the existing query tools, returning the skill file's content as the tool
        result.
  - [ ] Update the system prompt's skill-routing instruction per the checklist item above
        (sourced from `_LOAD_SKILL_overview.md`, covering all 13 skills — including the 4
        sub-skills `masking-and-shapes/smart-masking`, `masking-and-shapes/shapes`, `vlog`'s
        auto-load of `long-form-edit`, and `assembly/layouts` — not just the 9 top-level skills
        Custom's own `loadSkill` description names; this fork's overview deliberately surfaces all
        13 explicitly rather than leaving sub-skills to be discovered only via other tools'
        descriptions, since that indirection is easy for an agent to miss).
- [ ] **Decide the granular-observation tool overlap with Phase 14.** Custom's `context`,
      `viewItemDetails`, and `captureFrame` tools cover much of the same ground as this plan's
      Phase 14 (`GET_FRAME_AT`, `GET_TRANSCRIPT_RANGE`, `GET_CLIP_NEIGHBORS`). Reconcile rather
      than building two overlapping systems:
  - [ ] If Phase 14 hasn't landed yet, supersede it with Custom's richer shape directly (skip
        building the narrower Phase 14 tools, implement 26d below instead).
      - [ ] If Phase 14 has already landed, decide whether to extend its existing tools to match
        Custom's parameter shape (`include` categories, time-range scoping) or deprecate them in
        favor of the new ones — don't maintain two parallel observation-tool sets.

### 26b — Timeline assembly & manipulation tools

Maps to Custom's `long-form-edit` and general timeline tools. Most of these extend or replace
existing stubbed/partial actions from Phase 12 — check for overlap before adding a new action
type where an existing one can be extended.

- [ ] `ADD_MEDIA` — single-item and batch (max 30) placement, matching Custom's
      `trackPlacement`/`insertAfter` mutual exclusivity and the "new track / above:trackId /
      existing track" placement enum. Batch mode auto-chains items back-to-back on one track.
- [ ] `SPLIT_ITEM` — single or multi-timestamp split (N+1 chunks for multiple timestamps).
- [ ] `MOVE_ITEM` — absolute (`to`), relative (`by`), or snap-to-item (`before`/`after`)
      positioning; separately, trim/duration resizing with optional `ripple`. Batch mode only for
      relative (`by`) shifts, matching Custom's documented constraint — don't allow batch absolute
      moves, that's an actual usability hazard (ambiguous semantics for "move N items to the same
      absolute position").
- [ ] `DELETE_ITEMS` — batch delete with optional `ripple` to close gaps.
- [ ] `CLONE_ITEM` — duplicate with all properties/effects/masks/keyframes preserved, placed on a
      new track above.
- [ ] `CHANGE_TRACK` — move item to a different track (new or existing), preserving timeline
      position.
- [ ] `SLIP_ITEM` — shift the source trim window without changing position/duration.
- [ ] `CONSOLIDATE_TRACKS` — Tetris-style track packing; explicitly exclude caption tracks from
      consolidation (each caption pass owns its track for independent styling, per the skills
      reference).
- [ ] `TRANSFORM_ITEM` — position/scale/rotation/fit-to-canvas/fill-canvas/center, with the
      text-only `alignTop`/`alignBottom` safe-area behavior. Keep this distinct from
      `EDIT_PROPERTIES` (styling) per Custom's own explicit separation — don't let transform and
      style properties collapse into one action's params, that's exactly the kind of vocabulary
      sprawl Phase 13 is trying to eliminate elsewhere.
- [ ] `EDIT_PROPERTIES` — single or batch styling edits, scoped per item type (video/image/text/
      caption/audio/motionGraphic/shape) exactly as Custom documents per-type property lists. Don't
      allow scale/position here — that's `TRANSFORM_ITEM`'s job, enforce the separation in
      validation, not just documentation.
- [ ] `RESIZE_CANVAS` — aspect ratio change (16:9/9:16/1:1) with the explicit non-auto-scale
      behavior Custom documents (items keep original pixel dimensions; agent should ask the user
      whether to refit everything if their intent implies it).

### 26c — Captioning tools

Maps to Custom's `captioning-text` skill. This fork already has subtitle generation (v1) and
animated caption presets (Phase 22) — reconcile rather than duplicate.

- [ ] `ADD_CAPTIONS` — extend existing subtitle generation to match Custom's parameter shape:
      `source` (speech/music/all — music vs. speech-bearing item filtering), `sourceItems`
      (explicit override), `splitBySpeaker` (per-speaker track + palette color, namespaced per
      source asset), `sameTrack` (opt-in append to existing track, default false/new track per
      call), plus the styling params (font/color/size/border/background) and `templateId` for
      deterministic template application.
- [ ] `LIST_CAPTION_TEMPLATES` — expose existing or new caption templates with IDs/names/
      descriptions/tags/accent colors.
- [ ] `EDIT_ALL_CAPTION_STYLES` — bulk-restyle every caption on a track without touching text/
      timing; reuse for the per-speaker restyling flow `splitBySpeaker` sets up.
- [ ] Wire `LOAD_SKILL("captioning-text")` guidance to cover template selection, word-level
      timing, and multi-line wrapping — port Custom's skill content where it generalizes, adapt
      where this fork's caption renderer (Phase 22's keyframe-based per-word presets) differs
      from Custom's render-mode enum (default/highlight/word-by-word/slide-up/slide-left) —
      reconcile the two render-mode vocabularies into one, following the Phase 13 unification
      precedent (don't let captions become a second instance of the vocabulary-drift problem
      Phase 13 was created to fix).

### 26d — Granular observation & verification tools

Supersedes or extends Phase 14 per the 26a decision. This is the single highest-value adoption
from Custom's toolset — it directly closes the "agent is blind beyond ingest-time summaries" gap
identified in `REVIEW.md`.

- [ ] `CONTEXT(include, types, startSeconds, endSeconds)` — tiered timeline inspection: default
      lightweight overview (tracks, IDs, timing, short labels); `content` (detailed per-type,
      requires `types`); `transcript` (sentence-level); `transcript_words` (word-level, requires
      time range — token-heavy, scope tightly); `effects`/`keyframes`/`masks` (animation/
      compositing data, optionally time-scoped).
- [ ] `VIEW_ITEM_DETAILS(agentId | agentIds, include)` — single or batch deep inspection,
      including the `beats` category for music rhythm structure (BPM/tempo type by default;
      `beatsFrom`/`beatsTo` for individual pulse/onset data, keep ranges narrow — 5–15s — since
      onset data is token-heavy; single-`agentId`-only for beats, not batch).
- [ ] `CAPTURE_FRAME(timestamps?, quality)` — render the live preview canvas at given timestamps
      (or current playhead if omitted) and return actual images, for the agent to visually verify
      its own output (color grades, text placement, effect results) rather than trusting its plan
      executed correctly. **This is the agent self-checking capability flagged as a real gap and
      differentiation opportunity in `REVIEW.md`** — implement it against whichever renderer is
      live at the time (DOM-based today, or the binary renderer if Phase 25 has landed — note
      Phase 25 already calls out that a binary renderer's on-demand frame-stepping is a *better*
      foundation for exactly this kind of tool, so sequence accordingly if both are in flight).
- [ ] `VIEW_PROJECT_ASSETS()` — list all project assets with summaries (filename, content type,
      duration, resolution, recording date, analysis summary) — likely a thin wrapper over
      existing ingest-pipeline-persisted metadata (Phase 7, v1) rather than new computation.

### 26e — Masking & shape tools

Maps to Custom's `masking`, `masking-and-shapes/smart-masking`, and `masking-and-shapes/shapes`
skills. This is new capability for this fork — no equivalent exists today per the README's
feature list (chroma key requires a physical green screen; there's no general path/shape mask
system).

- [ ] `CREATE_MASK(agentId, method, ...)` — three mutually exclusive methods: (1) `textPrompt` for
      AI smart mask (SAM2-class model, clip-relative optional tracking window, max 30s of source
      per call — speed ramps affect this budget), (2) `shape` + `bounds` for preset shapes
      (rectangle/ellipse/triangle/pentagon/star/heart), (3) `points` for custom bezier path. Shape/
      points methods require `timelineSeconds` for canvas-pixel-to-mask-space conversion.
  - [ ] This requires a real segmentation model — reuse the model choice/sequencing decision from
        Phase 23 (background removal) rather than evaluating a second matting/segmentation model
        independently; if Phase 23's chosen model supports prompted/text-conditioned segmentation
        (check SAM2 specifically, since Custom's own skill reference names it), this tool and
        Phase 23's `REMOVE_BACKGROUND` can likely share inference infrastructure.
- [ ] `WRITE_MASK_POINTS` — patch-style path editing: add/update/remove points, or keyframed path
      morphing via `at`/`keyframeIndex` targeting, mutually exclusive `clearKeyframes`.
- [ ] `REMOVE_MASK`, `EDIT_MASK_PROPERTIES` (feather/opacity/mode/expansion/inverted) — mode enum
      add/subtract/intersect/difference.
- [ ] `ADD_SHAPE` — preset shape + bounds, or custom bezier points; rectangle/ellipse/triangle/
      pentagon/star/heart presets, fill/stroke/roundness styling.
- [ ] `WRITE_SHAPE_POINTS` — same patch-style path editing pattern as masks; share the underlying
      bezier-path-editing implementation between `WRITE_MASK_POINTS` and `WRITE_SHAPE_POINTS`
      rather than writing it twice, since the parameter shapes are nearly identical.
- [ ] Skill content for `masking` and `masking-and-shapes/smart-masking`: port the SAM2-limits,
      scribble-prompt, and tracking-failure-recovery guidance from the reference doc, adapted to
      whatever model is actually chosen in Phase 23/26e's shared-infrastructure decision above —
      don't port Custom's specific model-limit numbers if a different model is chosen; re-derive
      the real limits for the chosen model and document those instead.

### 26f — Keyframing & effects tools

Maps to Custom's `keyframing` skill plus its effects system (`writeEffects`, `listEffects`,
`getEffectDetails`). This generalizes and formalizes what Phase 19 (color match) and various
existing effects (filters, transitions) currently do ad hoc.

- [ ] `WRITE_KEYFRAMES(agentId, payload, effectId?, maskIndex?)` — one tool covering item-property,
      effect-parameter, and mask-property keyframes, with per-property `add`/`update`/`remove`/
      `replace` operations. Animatable item properties: opacity, scale, rotation, positionX/Y,
      width, height, blur, brightness, borderRadius, borderWidth, volume, fillOpacity,
      strokeWidth, strokeOpacity. **Critical gotcha to preserve from the skill reference: scale is
      0–100, not 0–1** — this exact kind of unit mismatch is the sort of thing that silently
      breaks agent-generated animations, call it out explicitly in this fork's own keyframing
      skill file, not just in code comments.
  - [ ] Easing presets: linear, easeIn/Out/InOut, easeIn/Out/InOutQuad, easeIn/Out/InOutCubic,
        easeIn/Out/InOutBack, easeOutElastic, easeOutBounce, plus custom cubic-bezier handles
        (`inHandle`/`outHandle`, segment-normalized per Custom's exact convention — reuse the same
        normalization so the easing math is one shared implementation, not three near-identical
        ones across keyframes/mask-points/shape-points).
- [ ] `WRITE_EFFECTS(agentId, add?, effects?)` — patch-style: `add` instantiates new effects
      (appended to stack), `effects` (keyed by effect instance ID) edits params/enabled/removes.
      Reconcile with this fork's existing 12 effects/22 filter presets/20 transitions (per
      README) — these become the effect catalog `LIST_EFFECTS`/`GET_EFFECT_DETAILS` serve, not a
      parallel system.
- [ ] `LIST_EFFECTS(itemType?)`, `GET_EFFECT_DETAILS(effectName | effectNames)` — discovery tools
      so the agent can query available effects/parameter schemas instead of having them all
      enumerated in the system prompt permanently (same token-efficiency rationale as the skill
      system).
- [ ] Skill content for `keyframing`: port the animatable-parameter list, the scale-unit gotcha,
      and easing/anticipation pattern guidance from the reference doc directly — this content is
      implementation-agnostic and transfers cleanly.

### 26g — Time-remapping, transitions, audio-sync, transcript-cleanup tools

- [ ] `SET_TIME_REMAP(agentId, keyframes, replace?)` — variable-speed playback via timeline-
      position → source-time keyframe mapping, same easing vocabulary as 26f's keyframing tool
      (share the easing implementation, don't duplicate it a third time). This generalizes
      Phase 21's speed-ramp-adjacent reverse/loop/boomerang work — check for overlap and prefer
      expressing reverse (negative slope) and loop (repeated keyframe pattern) as time-remap
      curves if that doesn't regress the simpler dedicated actions' usability for common cases.
- [ ] Transitions: this fork already has 20 transitions (README) — the `transitions` skill in
      Custom's reference has no associated tools of its own (transitions apply via existing
      item-adjacency, not a dedicated tool per the source doc) — confirm this fork's transition
      application mechanism (likely Phase 12's `ADD_TRANSITION`) is what the `transitions` skill
      should document, and write that skill file against this fork's actual mechanism, not
      Custom's (which wasn't specified in the source doc beyond the skill name).
- [ ] `SYNC_AND_SWAP(sourceAssetId, targetItemId, from, to)` — multi-camera sync via word-level
      transcript matching between two assets, placing the synced source at the calculated offset.
      Requires both assets to have transcripts — reuse this fork's existing Whisper-based
      transcription (v1) as the transcript source; don't build a second transcription path.
- [ ] `VIEW_ITEM_DETAILS`/`CONTEXT` with `beats` category (26d) is the `audio-sync` skill's
      primary tool per the reference — confirm 26d's beats support covers what `audio-sync`
      needs (tempo type, BPM, narrow-range onset data) before considering 26g's audio-sync
      coverage complete; this sub-phase mainly needs `SYNC_AND_SWAP` as the net-new tool, beats
      support belongs to 26d.
- [ ] Transcript-cleanup tools are the existing `CONTEXT`/`VIEW_ITEM_DETAILS` transcript/
      transcript_words categories from 26d, plus this fork's existing filler-word/silence
      detection (`silence_service.py`, wired as an agent tool back in Phase 3 of this plan) — no
      net-new tool needed here, just skill-file documentation tying the existing pieces together
      for this specific workflow (remove filler words/dead air).
- [ ] Write skill files for `time-remapping`, `transitions`, `audio-sync`, and
      `transcript-cleanup` — each is mostly "here's which existing tools to call and in what
      order for this workflow," not new mechanics, per the analysis above.

### 26h — Motion graphics tools (new capability — largest net-new build in this phase)

Maps to Custom's `motion-graphics` skill. **This is genuinely new infrastructure** — nothing in
this fork today supports arbitrary code-driven animated compositions; the closest existing
things are the keyframe/effect system (26f) and AI image/video generation (existing AI Video
Generation Hub). Sequence this sub-phase last within Phase 26, and treat it as the most
discretionary piece if time/resourcing runs short — the other sub-phases (26b–26g) close more
tangible "agent can't execute its own plan" gaps; this one adds a genuinely new editing
modality.

- [ ] Evaluate whether to adopt Remotion (React-component-to-video-frame rendering) as the
      underlying engine, matching Custom's own approach (`addMotionGraphic`'s `code` param is
      explicitly "React/Remotion component code"), versus a lighter-weight approach (e.g.
      driving this fork's existing keyframe/effect system with a constrained template+parameter
      model instead of arbitrary code). Arbitrary LLM-generated React code execution has real
      security/sandboxing implications (this is server/client-executed code, not just data) that
      Custom's own architecture must solve — research how before committing; do not wire up
      "agent writes React code, app `eval`s it" without a sandboxing story (e.g. iframe sandbox
      with restricted globals, or a WASM-isolated execution context, or Remotion's own
      server-side rendering path which renders to a video file rather than executing in the
      user's browser context at all — that last option is likely the safer fit if going this
      route, since it sidesteps live code execution in the editor's own page).
  - [ ] Document the security decision explicitly in `AGENTS.md` before implementation — this is
        a genuine risk surface, not a detail to leave implicit.
- [ ] `ADD_MOTION_GRAPHIC(code, summary, width, height, x, y, duration?)` — only after the
      sandboxing/rendering-path decision above is made and implemented safely.
- [ ] `EDIT_MOTION_GRAPHIC(agentId, action: view/patchCode/updateCode, patches?, code?, summary?)`
      — prefer targeted patch replacements over full-code replacement, matching Custom's stated
      preference (reduces the chance of an LLM regenerating subtly-broken full components when a
      small targeted change was all that was needed).
- [ ] `BROWSE_PRESETS(category?, query?)`, `APPLY_PRESET(presetId, timelineStart?)` — a curated
      preset catalog (collages, info-cards, lower-thirds, misc, overlays, slide-in-panels, text,
      title-cards) is a separate content-curation effort from the code-execution engine above —
      treat preset catalog population as its own task, likely lower effort than the rendering
      engine itself, and one that can ship a useful subset of motion-graphics capability (apply a
      pre-built preset) even if full arbitrary-code generation is deferred or descoped after the
      security review above.
- [ ] Write the `motion-graphics` skill file covering preset categories and the patchCode-
      preferred editing pattern.

### Sub-phase sequencing recommendation

Do 26a (foundational decisions) first — everything else depends on the ID scheme and skill
storage decisions. After that, 26b/26c/26d are the highest-value, most tractable wins (timeline
manipulation, captions, observation) and should land before 26e/26f/26g (masking, keyframing,
time-remap — meaningfully new mechanics but still data/transform problems, not new rendering
infrastructure). Land 26h last and treat its scope as negotiable if the security/sandboxing
question turns out to be a bigger lift than expected — shipping 26a through 26g already
represents this fork's agent reaching genuine parity with a sophisticated competitor's tool
surface; 26h is the one piece that's a wholly new product capability rather than a parity gap.

---



- [ ] Type-check (`bun run typecheck` or equivalent) across `apps/web`.
- [ ] Python static checks (`ruff`/`mypy`, else `python -m py_compile`) across
      `services/ai-backend` and any new service directories (notably `matting-service`).
- [ ] If Docker available, drive end-to-end through:
  - [ ] One full Co-Pilot goal that exercises a previously-stubbed action (Phase 12) to confirm
        it's no longer a no-op.
  - [ ] One command invoked via both `command.py`'s path and the Co-Pilot path post-unification
        (Phase 13), confirming identical timeline results.
  - [ ] One `GET_FRAME_AT`-driven reasoning step (Phase 14) — a goal that requires the agent to
        inspect a specific visual moment it couldn't have answered from ingest-time summaries
        alone.
  - [ ] One batch operation (Phase 15) with at least 5 matched segments, confirming the single
        confirmation step shows the full list and individual deselection works.
  - [ ] One template-started goal (Phase 16).
  - [ ] One full auto-dub run in at least one non-English target language (Phase 17).
  - [ ] One auto-cut-to-beat run (Phase 18) with visual confirmation the cuts land near beats.
  - [ ] One cross-clip color match (Phase 19) with a visibly-mismatched source pair.
  - [ ] One B-roll suggestion + insertion (Phase 20).
  - [ ] One of each quick-win effect: reverse, loop, boomerang (Phase 21).
  - [ ] One animated caption preset applied and rendered (Phase 22).
  - [ ] One background removal run (Phase 23), including a rough timing measurement on CPU.
  - [ ] One binary-rendering parity check (Phase 25): export a test project and compare against
        live preview captures at matching timestamps per Phase 25's defined parity criteria; run
        the before/after preview performance measurement on at least one CPU-only and one
        GPU-available machine.
  - [ ] Per Phase 26 sub-phase, at least one end-to-end smoke test: a multi-step goal that
        requires `LOAD_SKILL` followed by 2+ of that skill's associated tools (e.g. for
        `masking`: load the skill, then `CREATE_MASK` with `textPrompt`, then
        `EDIT_MASK_PROPERTIES`) — confirming the skill-loading mechanism actually changes agent
        behavior, not just that the tool returns text nobody acts on. Cover at minimum: 26b
        (a multi-tool timeline assembly goal), 26c (captions with `splitBySpeaker`), 26d
        (a `CAPTURE_FRAME` self-verification step after another action), 26e (a smart mask via
        `textPrompt`), 26f (a multi-keyframe animation with non-linear easing), 26g
        (`SYNC_AND_SWAP` on two real multi-cam test assets), and 26h if it shipped (one preset
        application at minimum, one code-generated motion graphic if the sandboxing path was
        completed).
  - [ ] A full stack restart, confirming all new derived assets/metadata persist (extends v1
        Phase 7's persistence guarantee to every new artifact type introduced this round).
- [ ] If Docker is not available: clearly state which parts were only statically verified vs.
      actually executed — do not claim end-to-end verification that didn't happen.
- [ ] Update `AGENTS.md` with anything learned this round: actual stub-closure findings from
      Phase 0, the vocabulary-unification decision made in Phase 13, the matting model chosen in
      Phase 23 and why, the duration-mismatch strategy decided in Phase 17, the fork-lineage
      finding and Path A/B decision from Phase 25, the `agentId` scheme and skill-storage
      decision from Phase 26a, and the motion-graphics sandboxing decision from Phase 26h.
- [ ] Update `README.md`'s feature list and competitor comparison table to reflect genuinely
      shipped capabilities from this round — don't list anything here that didn't pass its own
      phase's test criteria above.

## Explicit non-goals for this pass

- Not adopting upstream's separate ground-up rewrite (Rust-core, plugin architecture, MCP server
  for AI agents, headless mode — per upstream's own README) as a wholesale base for this fork.
  That rewrite is a different, much larger undertaking than the binary-renderer work in Phase 25
  and is not what was asked for here; revisit only if a future round explicitly decides this
  fork should re-platform entirely, which is a major strategic decision outside this plan's
  scope.
- Not aiming for verbatim feature-for-feature parity with Custom's exact ID strings, exact skill
  prose, or exact model choices (e.g. SAM2 specifically) where this fork's existing architecture
  differs — Phase 26 adapts the *shape* of Custom's tool/skill system to this codebase, not a
  byte-for-byte clone. Where adaptation requires a judgment call not already specified in this
  plan, prefer consistency with this fork's existing conventions (Phase 13's vocabulary
  unification, the `isDestructive` confirmation policy) over matching Custom's behavior exactly.
- Not building Phase 26h's arbitrary-code-execution motion graphics engine without first
  completing and documenting the sandboxing/security review specified in that sub-phase — if
  that review concludes the risk isn't worth it for this fork's threat model, ship 26h as
  preset-application-only (`BROWSE_PRESETS`/`APPLY_PRESET`) and treat full code-generation as a
  separately-scoped future decision, not a default fallback.

- Not building a stock media (video/photo/sticker) library integration — this is a real CapCut
  gap per `REVIEW.md` but requires a licensing/sourcing decision (e.g. Pexels/Pixabay API) that's
  a product decision, not just an engineering one. Revisit in a future round once that decision
  is made.
- Not building a large sticker/animated-overlay asset library — same reasoning, asset curation
  problem, not an AI-agent problem.
- Not building real-time multi-user collaboration — contradicts this project's self-hosted/
  single-operator privacy positioning; not a gap worth closing.
- Not building a mobile companion app — out of scope for this repo's stack and goals.
- Not adding profanity detection/auto-bleep — flagged in `REVIEW.md` as a gap but is a content-
  moderation feature with different risk/scope considerations than the editing-capability gaps
  prioritized here; revisit separately if there's real demand.
- Not adding dual-language simultaneous subtitle rendering — smaller-impact gap, revisit after
  Phase 22's animation work lands, since it touches the same rendering path and is easier to add
  once that's been refactored for per-word presets anyway.
- Not adding voice-changer (real-time pitch/formant effects) — distinct from voice cloning/TTS
  already supported; lower priority than the items above per `REVIEW.md`'s effort/impact sort.