# Phase 12: Manual Testing Steps

As part of Phase 12 (Close the action-executor stubs), the system implements the actions. Below are the steps to manually verify that they actually mutate the timeline/project state successfully.

## `TRIM_CLIP`
1. Load a clip into the timeline. Note its start and end times.
2. In the AI Assistant, run a command like "Trim the current clip to 5 seconds."
3. Observe the timeline updating, verify that `trimStart` and `trimEnd` match the requested trim times visually on the timeline element, reducing the clip length.

## `ADD_TRANSITION`
1. Add two clips to the timeline adjacent to each other.
2. Tell the AI assistant: "Add a crossfade transition between clips."
3. Select the clips, verify that `transitionOut` has been set to the transition type (e.g. crossfade) with duration.

## `ADD_SUBTITLE_TRACK`
1. Upload a video and process its transcript.
2. Run the command: "Add subtitles to the timeline".
3. Check that a new track (type: "text") is created, and text elements are correctly inserted corresponding to the generated Whisper segments.

## `ADD_IMAGE_OVERLAY`
1. Instruct the AI assistant to "Add an image overlay from URL <some-url>".
2. Check that a new video track is created and an image element appears, visually overlapping the base video.

## `ADD_VOICEOVER`
1. Send the command: "Add a voiceover saying 'Welcome to OpenCut'".
2. Observe the timeline adding a new audio track and an audio element for the voiceover. Play the timeline and confirm you hear the generated TTS.

## `DENOISE_AUDIO`
1. Add a noisy audio clip to the timeline.
2. Command: "Denoise this audio with strength 0.8".
3. The original audio asset will be swapped out for the denoised URL. Playback should reflect improved audio quality.

## `GENERATE_IMAGE`
1. Give command "Generate an image of a red panda".
2. A new image will be added to the timeline on a new track (also automatically added to the project media assets). Visually confirm the new image in the timeline.

## `ADD_MUSIC`
1. Command: "Add background music that sounds cinematic".
2. The system should fetch an mp3 from Freesound and add it to an audio track. Verify a new audio track appears and the music plays.

## `NORMALIZE_AUDIO`
1. With audio elements on the timeline, ask to "Normalize audio to -14 LUFS".
2. Observe the action adjusting the `volume` parameters of all audio-containing elements on the tracks to reach the target LUFS level.

## `AUTO_DUCK`
1. Have both a voice track and a music track on the timeline.
2. Command: "Auto duck music by -12dB".
3. Observe that volume keyframes/levels are added/adjusted on the music track where there is speech.

## `COLOR_CORRECT`
1. Add a video clip.
2. Command "Apply color correction".
3. Observe a `color_adjust` effect being added to the element, changing its visuals.

## `EXPORT_PROJECT`
1. Command: "Export project".
2. You will be prompted with a confirmation dialog (because this is potentially destructive or heavy). Accept it and confirm a video file downloads successfully.
