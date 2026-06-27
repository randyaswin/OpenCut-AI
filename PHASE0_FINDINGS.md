# Phase 0 Findings: Setup & Re-verification

I have audited the codebase against the claims in `AGENTS.md` and `PLAN.md`. Since Docker is not available in my current environment, my verifications are based on static code reads and file inspections.

Here are the precise findings:

## 1. Stub Status of Actions in `ai-action-executor.ts`
**Claim:** Several actions (NORMALIZE_AUDIO, AUTO_DUCK, COLOR_CORRECT, ADD_SUBTITLE_TRACK, ADD_IMAGE_OVERLAY, TRIM_CLIP, ADD_TRANSITION, ADD_VOICEOVER, DENOISE_AUDIO, GENERATE_IMAGE, ADD_MUSIC, EXPORT_PROJECT) are `console.warn` stubs.
**Finding:** **FALSE**. The prior audit is stale. All of these actions have full, substantive implementations in `apps/web/src/lib/ai-action-executor.ts` (inside the `executeAction` switch statement).
- `NORMALIZE_AUDIO` (line 344): Iterates over tracks and pushes volume updates.
- `AUTO_DUCK` (line 369): Checks for speech/music tracks and adjusts volume.
- `COLOR_CORRECT` (line 403): Adds `colorCorrection` effect to elements.
- `ADD_SUBTITLE_TRACK` (line 511): Converts transcript segments to a subtitle track.
- `ADD_IMAGE_OVERLAY` (line 550): Adds an image asset and places it on a new track.
- `TRIM_CLIP` (line 584): Adjusts `trimStart` and `trimEnd`.
- `ADD_TRANSITION` (line 616): Sets transition on timeline elements.
- `ADD_VOICEOVER` (line 645): Calls `aiClient.generateSpeechBlob` and adds the audio track.
- `DENOISE_AUDIO` (line 678): Calls `aiClient.denoiseAudio` and swaps out the audio asset.
- `GENERATE_IMAGE` (line 732): Calls `aiClient.generateImage`.
- `ADD_MUSIC` (line 766): Fetches Freesound audio from `/api/sounds/search` and inserts it.
- `EXPORT_PROJECT` (line 812): Calls `editor.renderer.exportProject`.

Additionally, I checked the rest of the 36 `EditorActionType`s defined in `types/ai.ts`. **None of them are `console.warn` stubs.** The only `console.warn` is in the `default` case for unknown actions (line 1093) or for handling missing assets/files.

## 2. Vocabulary Reconciliation (`EditorActionType` vs `command.py`)
**Claim:** `services/ai-backend/app/routes/command.py` uses a separate action vocabulary (`cut`, `trim`, `delete`, `add_text`) that has never been reconciled with `EditorActionType`.
**Finding:** **FALSE**. The vocabularies have *already* been reconciled.
In `services/ai-backend/app/routes/command.py`, `COMMAND_SYSTEM_PROMPT` explicitly lists `REMOVE_SEGMENTS`, `REMOVE_FILLERS`, `TRIM_CLIP`, `ADD_TRANSITION`, `NORMALIZE_AUDIO`, etc. (lines 17-38). It returns JSON containing `{ "type": "...", "params": {...} }` exactly matching `EditorActionType`. The old vocabulary (`cut`, `delete`, etc.) no longer exists in `command.py`.

## 3. Phase 9 & 10/11 Implementations
**Claim:** Phase 9 (Freesound auto-select) and Phase 10/11 (object-detection non-face auto-reframe) from PLAN.md need to be sequenced, implying they are unstarted.
**Finding:** **Both are already implemented (partially or fully).**
- **Phase 9 (Freesound):** The `ADD_MUSIC` action in `ai-action-executor.ts` (line 766) already calls `fetch('/api/sounds/search?q=...')`, extracts the first preview URL from Freesound, downloads it into a `Blob`, and adds it to the timeline.
- **Phase 10/11 (Object-detection auto-reframe):** The `AUTO_REFRAME` action in `ai-action-executor.ts` (line 822) accepts a `subject` parameter and passes it to `aiClient.detectFaces(..., { subject })`. In `services/ai-backend/app/services/face_reframe.py`, there is already an async method `_detect_objects` (line 392) that runs `YOLO("yolov8n.pt")` if a `target_subject` is provided. This is routed through `podcast.py` (`@router.post("/faces")`), meaning the non-face auto-reframe is already wired in.

## 4. OpenAI-compatible LLM Backend Path
**Claim:** Ensure the OpenAI-compatible path is genuinely wired and selectable end-to-end.
**Finding:** **TRUE / Verified**. In `services/ai-backend/app/services/model_backend.py`, the OpenAI path is fully implemented in `_openai_chat` and `_get_openai_client`. The `chat` and `chat_stream` methods explicitly route to it if `_should_use_openai()` is true (e.g., checking `self.backend_mode == "openai"` or fallback).

## Summary
Most of the work scheduled for Phase 12 (stub closure) and Phase 13 (vocabulary unification), as well as Phase 9 (Freesound) and 10/11 (YOLO non-face reframe), has **already been implemented** in `main`. The `AGENTS.md` and `PLAN.md` documents are significantly out of sync with the actual codebase.
