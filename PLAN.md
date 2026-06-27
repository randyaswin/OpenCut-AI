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

## Phase 24 — Verification (this round)

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
  - [ ] A full stack restart, confirming all new derived assets/metadata persist (extends v1
        Phase 7's persistence guarantee to every new artifact type introduced this round).
- [ ] If Docker is not available: clearly state which parts were only statically verified vs.
      actually executed — do not claim end-to-end verification that didn't happen.
- [ ] Update `AGENTS.md` with anything learned this round: actual stub-closure findings from
      Phase 0, the vocabulary-unification decision made in Phase 13, the matting model chosen in
      Phase 23 and why, and the duration-mismatch strategy decided in Phase 17.
- [ ] Update `README.md`'s feature list and competitor comparison table to reflect genuinely
      shipped capabilities from this round — don't list anything here that didn't pass its own
      phase's test criteria above.

## Explicit non-goals for this pass

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