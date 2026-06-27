import type { EditorAction, EditorActionType } from "@/types/ai";
import { useTranscriptStore } from "@/stores/transcript-store";
import { aiClient } from "@/lib/ai-client";

function getTranscriptStore() {
	return useTranscriptStore.getState();
}

function getEditorCore() {
	const { EditorCore } = require("@/core");
	return EditorCore.getInstance();
}

export function isDestructiveAction(actionType: EditorActionType): boolean {
	return [
		"REMOVE_SEGMENTS",
		"DELETE_CLIPS",
		"REMOVE_TRACK",
		"REMOVE_SILENCE",
		"REMOVE_FILLERS",
		"TRIM_CLIP",
		"SPLIT_CLIP",
		"EXPORT_PROJECT",
	].includes(actionType);
}

function isElementTargeted(el: any, action: any, store: any): boolean {
	const clipIds = action.params.clipIds as string[] | undefined;
	const segmentIds = action.params.segmentIds as number[] | undefined;
	
	if (clipIds && clipIds.length > 0) {
		if (clipIds.includes(el.id)) return true;
	}
	
	if (segmentIds && segmentIds.length > 0) {
		const targetSegments = store.segments.filter((s: any) => segmentIds.includes(s.id));
		const elEnd = el.startTime + el.duration;
		for (const seg of targetSegments) {
			if (seg.start < elEnd && seg.end > el.startTime) {
				return true;
			}
		}
		return false;
	}
	
	if (!clipIds?.length && !segmentIds?.length) return true;
	
	return false;
}

export function previewAction(action: EditorAction): string {
	switch (action.type) {
		case "REMOVE_SEGMENTS": {
			const ids = action.params.segmentIds as number[] | undefined;
			const count = ids?.length ?? 0;
			return `Remove ${count} segment${count !== 1 ? "s" : ""} from the transcript`;
		}
		case "ADD_SUBTITLE_TRACK":
			return `Add subtitle track with style "${action.params.preset ?? "default"}"`;
		case "ADD_IMAGE_OVERLAY":
			return `Add image overlay at position (${action.params.x ?? 0}, ${action.params.y ?? 0})`;
		case "TRIM_CLIP": {
			const start = action.params.start as number | undefined;
			const end = action.params.end as number | undefined;
			return `Trim clip from ${start?.toFixed(2) ?? "?"}s to ${end?.toFixed(2) ?? "?"}s`;
		}
		case "ADD_TRANSITION":
			return `Add "${action.params.transitionType ?? "crossfade"}" transition`;
		case "SPLIT_CLIP": {
			const at = action.params.time as number | undefined;
			return `Split clip at ${at?.toFixed(2) ?? "?"}s`;
		}
		case "ADD_TEXT_OVERLAY":
			return `Add text overlay: "${action.params.text ?? ""}"`;
		case "ADJUST_SPEED": {
			const speed = action.params.speed as number | undefined;
			return `Adjust playback speed to ${speed ?? 1}x`;
		}
		case "ADD_VOICEOVER":
			return "Add voiceover narration";
		case "REMOVE_SILENCE": {
			const threshold = action.params.threshold as number | undefined;
			return `Remove silent segments (threshold: ${threshold ?? 0.5}s)`;
		}
		case "REMOVE_FILLERS": {
			const words = action.params.fillerWords as string[] | undefined;
			return `Remove filler words${words ? `: ${words.join(", ")}` : ""}`;
		}
		case "ADD_CHAPTER_MARKERS": {
			const count = (action.params.chapters as unknown[] | undefined)?.length;
			return `Add ${count ?? 0} chapter marker${count !== 1 ? "s" : ""}`;
		}
		case "DENOISE_AUDIO": {
			const strength = action.params.strength as number | undefined;
			return `Denoise audio (strength: ${strength ?? 0.5})`;
		}
		case "GENERATE_IMAGE":
			return `Generate image: "${action.params.prompt ?? ""}"`;
		case "SET_CANVAS_SIZE":
			return `Set canvas to ${action.params.label ?? `${action.params.width}x${action.params.height}`}`;
		case "ADD_MUSIC":
			return `Add background music: "${action.params.query ?? "auto"}" (${action.params.duration ?? 30}s)`;
		case "NORMALIZE_AUDIO":
			return `Normalize audio to ${action.params.targetLUFS ?? -14} LUFS`;
		case "AUTO_DUCK":
			return `Auto-duck music under speech (${action.params.duckAmount ?? -12}dB)`;
		case "COLOR_CORRECT":
			return `Apply "${action.params.profile ?? "auto"}" color correction`;
		case "ADD_EFFECT":
			return `Add "${action.params.effectType ?? "filter"}" effect to timeline clips`;
		case "AUTO_REFRAME":
			return `Auto-reframe to ${action.params.targetRatio ?? "9:16"}${action.params.subject ? ` following "${action.params.subject}"` : ""}`;
		case "ADD_MEDIA_TO_TIMELINE":
			return `Add asset to timeline`;
		default:
			return action.description;
	}
}

export async function executeAction(action: EditorAction): Promise<void> {
	const store = getTranscriptStore();

	switch (action.type) {
		case "REMOVE_SEGMENTS": {
			const ids = action.params.segmentIds as number[] | undefined;
			if (ids && ids.length > 0) {
				store.deleteSegments(ids);
			}
			break;
		}

		case "REMOVE_FILLERS": {
			const fillerSegmentIds = store.fillers
				.filter((f) => f.isFiller)
				.map((f) => f.segmentIndex);
			const uniqueIds = [...new Set(fillerSegmentIds)];

			for (const segment of store.segments) {
				if (uniqueIds.includes(segment.id)) {
					const fillerWordsInSegment = store.fillers.filter(
						(f) => f.segmentIndex === segment.id && f.isFiller,
					);
					let cleanedText = segment.text;
					for (const filler of fillerWordsInSegment) {
						cleanedText = cleanedText.replace(
							new RegExp(`\\b${filler.word}\\b`, "gi"),
							"",
						);
					}
					cleanedText = cleanedText.replace(/\s+/g, " ").trim();
					store.updateSegment(segment.id, { text: cleanedText });
				}
			}
			break;
		}

		case "REMOVE_SILENCE": {
			const silences = store.silences;
			const segmentsToRemove = store.segments
				.filter((seg) =>
					silences.some(
						(silence) => seg.start >= silence.start && seg.end <= silence.end,
					),
				)
				.map((seg) => seg.id);

			if (segmentsToRemove.length > 0) {
				store.deleteSegments(segmentsToRemove);
			}
			break;
		}

		case "ADD_CHAPTER_MARKERS": {
			const chapters = action.params.chapters as
				| { title: string; start: number; end: number; summary?: string }[]
				| undefined;
			if (chapters) {
				store.setChapters(chapters);
			}
			break;
		}

		case "ADD_MEDIA_TO_TIMELINE": {
			const assetId = action.params.assetId as string;
			if (!assetId) break;
			
			const editor = getEditorCore();
			const asset = editor.media.getAssetById(assetId);
			if (!asset) {
				console.warn(`Asset ${assetId} not found`);
				break;
			}
			
			let trackId = action.params.trackId as string | undefined;
			let startTime = action.params.startTime as number | undefined;
			
			if (!trackId) {
				const tracks = editor.timeline.getTracks();
				const targetTrack = tracks.find((t: any) => t.type === asset.type) || tracks[0];
				if (targetTrack) {
					trackId = targetTrack.id;
				} else {
					trackId = editor.timeline.addTrack({ type: asset.type });
				}
			}
			
			if (startTime === undefined) {
				const tracks = editor.timeline.getTracks();
				const track = tracks.find((t: any) => t.id === trackId);
				if (track && track.elements.length > 0) {
					startTime = Math.max(...track.elements.map((e: any) => e.startTime + e.duration));
				} else {
					startTime = 0;
				}
			}
			
			const { generateUUID } = require("@/utils/id");
			const elementId = generateUUID();
			
			const element = {
				id: elementId,
				type: asset.type,
				name: asset.name,
				startTime,
				duration: asset.duration || 5,
				trackId,
				mediaId: asset.id,
				trimStart: 0,
				trimEnd: asset.duration || 5,
				opacity: 100,
				transform: { scale: 1, position: { x: 0, y: 0 }, rotate: 0 },
				animations: { channels: {} },
				effects: [],
				...(asset.type === "audio" ? { sourceType: "upload" as const, volume: 100 } : {})
			};
			
			editor.timeline.insertElement({ element, placement: { mode: "explicit" as const, trackId } });
			break;
		}

		case "SET_CANVAS_SIZE": {
			try {
				const editor = getEditorCore();
				let width = action.params.width as number;
				let height = action.params.height as number;
				const label = (action.params.label as string || "").toLowerCase();
				
				if (!width || !height) {
					if (label.includes("9:16") || label.includes("portrait") || label.includes("vertical") || label.includes("tiktok") || label.includes("reel") || label.includes("shorts")) {
						width = 1080;
						height = 1920;
					} else if (label.includes("1:1") || label.includes("square")) {
						width = 1080;
						height = 1080;
					} else {
						width = 1920;
						height = 1080;
					}
				}

				editor.project.updateSettings({
					settings: {
						canvasSize: { width, height },
					}
				});
			} catch {}
			break;
		}

		case "ADD_TEXT_OVERLAY": {
			try {
				const editor = getEditorCore();
				const tracks = editor.timeline.getTracks();
				const textTrack = tracks.find((t: any) => t.type === "text");
				if (textTrack) {
					editor.timeline.insertElement({
						element: {
							type: "text",
							sourceType: "upload",
							name: (action.params.text as string) ?? "Text",
							text: (action.params.text as string) ?? "",
							startTime: 0,
							duration: 5,
							trimStart: 0,
							trimEnd: 0,
							x: (action.params.x as number) ?? 0.5,
							y: (action.params.y as number) ?? 0.5,
						} as any,
						placement: { mode: "explicit" as const, trackId: textTrack.id },
					});
				}
			} catch {}
			break;
		}

		case "SPLIT_CLIP": {
			try {
				const editor = getEditorCore();
				const time = action.params.time as number;
				if (time > 0) {
					const tracks = editor.timeline.getTracks();
					for (const track of tracks) {
						for (const el of track.elements) {
							if (time > el.startTime && time < el.startTime + el.duration) {
								editor.timeline.splitElements({
									elements: [{ trackId: track.id, elementId: el.id, time }],
								});
							}
						}
					}
				}
			} catch {}
			break;
		}

		case "ADJUST_SPEED": {
			try {
				const editor = getEditorCore();
				const speed = (action.params.speed as number) ?? 1;
				const tracks = editor.timeline.getTracks();
				const updates: Array<{
					trackId: string;
					elementId: string;
					updates: any;
				}> = [];
				for (const track of tracks) {
					for (const el of track.elements) {
						if (el.type === "video") {
							updates.push({
								trackId: track.id,
								elementId: el.id,
								updates: { playbackRate: speed },
							});
						}
					}
				}
				if (updates.length > 0) {
					editor.timeline.updateElements({ updates });
				}
			} catch {}
			break;
		}

		case "NORMALIZE_AUDIO": {
			try {
				const editor = getEditorCore();
				const tracks = editor.timeline.getTracks();
				const updates: Array<{ trackId: string; elementId: string; updates: any }> = [];
				for (const track of tracks) {
					for (const el of track.elements) {
						if (el.type === "video" || el.type === "audio") {
							updates.push({
								trackId: track.id,
								elementId: el.id,
								updates: { volume: 1.0 },
							});
						}
					}
				}
				if (updates.length > 0) {
					editor.timeline.updateElements({ updates });
				}
			} catch (e) {
				console.error(e);
			}
			break;
		}

		case "AUTO_DUCK": {
			try {
				const editor = getEditorCore();
				const tracks = editor.timeline.getTracks();
				const duckAmount = (action.params.duckAmount as number) ?? -12;
				const linearVolume = Math.pow(10, duckAmount / 20);
				
				const silences = store.silences;
				const segments = store.segments;
				
				for (const track of tracks) {
					if (track.type === "audio") {
						for (const el of track.elements) {
							const keyframes = [];
							for (const seg of segments) {
								if (seg.start >= el.startTime && seg.start <= el.startTime + el.duration) {
									keyframes.push({ trackId: track.id, elementId: el.id, propertyPath: "volume" as const, time: seg.start - 0.5, value: 1.0, interpolation: "linear" as const });
									keyframes.push({ trackId: track.id, elementId: el.id, propertyPath: "volume" as const, time: seg.start, value: linearVolume, interpolation: "linear" as const });
									keyframes.push({ trackId: track.id, elementId: el.id, propertyPath: "volume" as const, time: seg.end, value: linearVolume, interpolation: "linear" as const });
									keyframes.push({ trackId: track.id, elementId: el.id, propertyPath: "volume" as const, time: seg.end + 0.5, value: 1.0, interpolation: "linear" as const });
								}
							}
							if (keyframes.length > 0) {
								editor.timeline.upsertKeyframes({ keyframes });
							}
						}
					}
				}
			} catch (e) {
				console.error(e);
			}
			break;
		}

		case "COLOR_CORRECT": {
			try {
				const editor = getEditorCore();
				const tracks = editor.timeline.getTracks();
				for (const track of tracks) {
					for (const el of track.elements) {
						if (el.type === "video" || el.type === "image") {
							editor.timeline.addClipEffect({
								trackId: track.id,
								elementId: el.id,
								effectType: "color_adjust",
							});
						}
					}
				}
			} catch (e) {
				console.error(e);
			}
			break;
		}

		case "ADD_EFFECT": {
			try {
				const editor = getEditorCore();
				const tracks = editor.timeline.getTracks();
				const effectType = (action.params.effectType as string) ?? "filter";
				const effectParams = action.params.effectParams as Record<string, any>;
				for (const track of tracks) {
					for (const el of track.elements) {
						if ((el.type === "video" || el.type === "image") && isElementTargeted(el, action, store)) {
							const effectId = editor.timeline.addClipEffect({
								trackId: track.id,
								elementId: el.id,
								effectType: effectType,
							});
							if (effectId && effectParams) {
								editor.timeline.updateEffectParams({
									trackId: track.id,
									elementId: el.id,
									effectId: effectId,
									params: effectParams
								});
							}
						}
					}
				}
			} catch (e) {
				console.error(e);
			}
			break;
		}

		case "ADJUST_VISUALS": {
			try {
				const editor = getEditorCore();
				const tracks = editor.timeline.getTracks();
				const params = action.params as Record<string, any>;
				for (const track of tracks) {
					for (const el of track.elements) {
						if ((el.type === "video" || el.type === "image") && isElementTargeted(el, action, store)) {
							const colorAdjustParams: Record<string, number> = {};
							if (typeof params.brightness === "number") colorAdjustParams.brightness = params.brightness;
							if (typeof params.contrast === "number") colorAdjustParams.contrast = params.contrast;
							if (typeof params.saturation === "number") colorAdjustParams.saturation = params.saturation;
							if (typeof params.temperature === "number") colorAdjustParams.temperature = params.temperature;
							if (typeof params.exposure === "number") colorAdjustParams.exposure = params.exposure;
							if (typeof params.hue === "number") colorAdjustParams.hue = params.hue;
							
							if (Object.keys(colorAdjustParams).length > 0) {
								const effectId = editor.timeline.addClipEffect({
									trackId: track.id,
									elementId: el.id,
									effectType: "color_adjust",
								});
								if (effectId) {
									editor.timeline.updateEffectParams({
										trackId: track.id,
										elementId: el.id,
										effectId: effectId,
										params: colorAdjustParams
									});
								}
							}
							
							if (typeof params.vignette === "number") {
								const effectId = editor.timeline.addClipEffect({
									trackId: track.id,
									elementId: el.id,
									effectType: "vignette",
								});
								if (effectId) {
									editor.timeline.updateEffectParams({
										trackId: track.id,
										elementId: el.id,
										effectId: effectId,
										params: { amount: params.vignette }
									});
								}
							}
						}
					}
				}
			} catch (e) {
				console.error(e);
			}
			break;
		}

		case "ADD_SUBTITLE_TRACK": {
			try {
				const editor = getEditorCore();
				const segments = store.segments;
				if (segments.length === 0) break;
				
				const trackId = editor.timeline.addTrack({ type: "text" });
				
				for (const seg of segments) {
					editor.timeline.insertElement({
						element: {
							type: "text",
							sourceType: "upload",
							name: "Subtitle",
							content: seg.text,
							startTime: seg.start,
							duration: seg.end - seg.start,
							trimStart: 0,
							trimEnd: 0,
							fontSize: 48,
							fontFamily: "Inter",
							color: "#FFFFFF",
							textAlign: "center",
							fontWeight: "bold",
							fontStyle: "normal",
							textDecoration: "none",
							background: { enabled: true, color: "#00000088", paddingX: 16, paddingY: 8, cornerRadius: 8 },
							transform: { scale: 1, position: { x: 0, y: 350 }, rotate: 0 },
							opacity: 1
						} as any,
						placement: { mode: "explicit" as const, trackId, startTime: seg.start },
					});
				}
			} catch (e) {
				console.error(e);
			}
			break;
		}

		case "ADD_IMAGE_OVERLAY": {
			try {
				const editor = getEditorCore();
				const url = action.params.url as string;
				if (!url) break;
				
				const trackId = editor.timeline.addTrack({ type: "video" });
				const projectId = editor.project.getActive().id;
				
				const res = await fetch(url);
				const blob = await res.blob();
				const file = new File([blob], "overlay.png", { type: res.headers.get("content-type") || "image/png" });
				const mediaId = await editor.media.addMediaAsset({ projectId, asset: { type: "image", file, url: URL.createObjectURL(file), name: "Overlay Image", width: 1024, height: 1024 } as any });
				
				editor.timeline.insertElement({
					element: {
						type: "image",
						mediaId,
						name: "Overlay Image",
						startTime: 0,
						duration: 5,
						trimStart: 0,
						trimEnd: 0,
						opacity: 1,
						transform: { scale: 1, position: { x: 0, y: 0 }, rotate: 0 }
					} as any,
					placement: { mode: "explicit" as const, trackId, startTime: 0 }
				});
			} catch (e) {
				console.error(e);
			}
			break;
		}

		case "TRIM_CLIP": {
			try {
				const editor = getEditorCore();
				const start = action.params.start as number | undefined;
				const end = action.params.end as number | undefined;
				if (start !== undefined && end !== undefined) {
					const tracks = editor.timeline.getTracks();
					let trimmed = false;
					for (const track of tracks) {
						for (const el of track.elements) {
							if (el.type === "video") {
								const currentTrimStart = el.trimStart ?? 0;
								editor.timeline.updateElementTrim({
									elementId: el.id,
									trimStart: currentTrimStart + start,
									trimEnd: currentTrimStart + end,
									startTime: el.startTime,
									duration: end - start
								});
								trimmed = true;
								break;
							}
						}
						if (trimmed) break;
					}
				}
			} catch (e) {
				console.error(e);
			}
			break;
		}

		case "ADD_TRANSITION": {
			try {
				const editor = getEditorCore();
				const tracks = editor.timeline.getTracks();
				const transitionType = (action.params.transitionType as string) || "crossfade";
				const duration = (action.params.duration as number) || 1.0;
				for (const track of tracks) {
					for (let i = 0; i < track.elements.length - 1; i++) {
						const el = track.elements[i];
						const next = track.elements[i + 1];
						if (isElementTargeted(el, action, store) || isElementTargeted(next, action, store)) {
							if (Math.abs(el.startTime + el.duration - next.startTime) < 0.1) {
								editor.timeline.updateElements({
									updates: [{
										trackId: track.id,
										elementId: el.id,
										updates: { transitionOut: { type: transitionType, duration } }
									}]
								});
							}
						}
					}
				}
			} catch (e) {
				console.error(e);
			}
			break;
		}

		case "ADD_VOICEOVER": {
			try {
				const text = action.params.text as string;
				if (!text) break;
				
				const blob = await aiClient.generateSpeechBlob({ text, language: "en", speaker: "default" });
				const editor = getEditorCore();
				const trackId = editor.timeline.addTrack({ type: "audio" });
				const projectId = editor.project.getActive().id;
				
				const file = new File([blob], "voiceover.wav", { type: "audio/wav" });
				const mediaId = await editor.media.addMediaAsset({ projectId, asset: { type: "audio", file, url: URL.createObjectURL(file), name: "Voiceover" } as any });
				
				editor.timeline.insertElement({
					element: {
						type: "audio",
						sourceType: "upload",
						mediaId,
						name: "Voiceover",
						startTime: 0,
						duration: 5,
						trimStart: 0,
						trimEnd: 0,
						volume: 1.0,
					} as any,
					placement: { mode: "explicit" as const, trackId, startTime: 0 },
				});
			} catch (e) {
				console.error(e);
			}
			break;
		}

		case "DENOISE_AUDIO": {
			try {
				const strength = (action.params.strength as number) ?? 0.7;
				const editor = getEditorCore();
				const tracks = editor.timeline.getTracks();
				let foundElement: any = null;
				let foundFile: File | null = null;

				for (const track of tracks) {
					for (const element of track.elements) {
						if (
							(track.type === "video" || track.type === "audio") &&
							element.mediaId
						) {
							const asset = editor.media.getAssets().find((a: any) => a.id === element.mediaId);
							if (asset?.file) {
								foundElement = element;
								foundFile = asset.file;
								break;
							}
						}
					}
					if (foundFile) break;
				}

				if (!foundFile || !foundElement) {
					console.warn("[ai-action-executor] No audio or video file found to denoise.");
					break;
				}

				const res = await aiClient.denoiseAudio(foundFile, strength);
				const audioRes = await fetch(res.audioUrl);
				const blob = await audioRes.blob();
				const file = new File([blob], `denoised_${foundFile.name}`, { type: audioRes.headers.get("content-type") || "audio/wav" });
				
				const projectId = editor.project.getActive().id;
				const mediaId = await editor.media.addMediaAsset({
					projectId,
					asset: {
						type: "audio",
						file,
						url: URL.createObjectURL(file),
						name: `Denoised ${foundFile.name}`,
						duration: foundElement.duration,
					} as any,
				});

				editor.timeline.updateElement(foundElement.id, { mediaId });
			} catch (e) {
				console.error("[ai-action-executor] Denoise failed:", e);
			}
			break;
		}

		case "GENERATE_IMAGE": {
			try {
				const prompt = action.params.prompt as string;
				if (!prompt) break;
				const res = await aiClient.generateImage({ prompt, width: 1024, height: 1024, steps: 30, guidanceScale: 7.5 });
				const editor = getEditorCore();
				const trackId = editor.timeline.addTrack({ type: "video" });
				const projectId = editor.project.getActive().id;
				
				const imgRes = await fetch(res.imageUrl);
				const blob = await imgRes.blob();
				const file = new File([blob], "generated.png", { type: imgRes.headers.get("content-type") || "image/png" });
				const mediaId = await editor.media.addMediaAsset({ projectId, asset: { type: "image", file, url: URL.createObjectURL(file), name: "AI Image", width: 1024, height: 1024 } as any });
				
				editor.timeline.insertElement({
					element: {
						type: "image",
						mediaId,
						name: "Generated Image",
						startTime: 0,
						duration: 5,
						trimStart: 0,
						trimEnd: 0,
						opacity: 1,
						transform: { scale: 1, position: { x: 0, y: 0 }, rotate: 0 }
					} as any,
					placement: { mode: "explicit" as const, trackId, startTime: 0 }
				});
			} catch (e) {
				console.error(e);
			}
			break;
		}

		case "ADD_MUSIC": {
			try {
				const editor = getEditorCore();
				const projectId = editor.project.getActive().id;
				const query = action.params.query as string || `${action.params.genre || ""} ${action.params.mood || ""}`.trim() || "background music";

				const res = await fetch(`/api/sounds/search?q=${encodeURIComponent(query)}&type=songs`);
				if (!res.ok) throw new Error("Failed to search Freesound");
				
				const data = await res.json();
				if (data.results && data.results.length > 0) {
					const sound = data.results[0];
					const previewUrl = sound.previewUrl;
					
					if (previewUrl) {
						const audioRes = await fetch(previewUrl);
						const blob = await audioRes.blob();
						const file = new File([blob], "music.mp3", { type: audioRes.headers.get("content-type") || "audio/mpeg" });
						
						const mediaId = await editor.media.addMediaAsset({ projectId, asset: { type: "audio", file, url: URL.createObjectURL(file), name: sound.name, duration: sound.duration || action.params.duration || 30 } as any });
						const trackId = editor.timeline.addTrack({ type: "audio" });
						
						editor.timeline.insertElement({
							element: {
								type: "audio",
								sourceType: "upload",
								mediaId,
								name: sound.name,
								startTime: 0,
								duration: sound.duration || action.params.duration || 30,
								trimStart: 0,
								trimEnd: 0,
								volume: 0.5,
							} as any,
							placement: { mode: "explicit" as const, trackId, startTime: 0 },
						});
						break;
					}
				}
				console.warn("[ai-action-executor] Freesound returned no results or missing preview URL.");
			} catch (e) {
				console.error("[ai-action-executor] Failed to add music:", e);
			}
			break;
		}

		case "EXPORT_PROJECT": {
			try {
				const editor = getEditorCore();
				await editor.renderer.exportProject({ options: { format: "mp4", quality: "high", fps: 30, includeAudio: true, includeWatermark: false } });
			} catch (e) {
				console.error(e);
			}
			break;
		}

		case "AUTO_REFRAME": {
			try {
				const editor = getEditorCore();
				const targetRatioStr = (action.params.targetRatio as string) ?? "9:16";
				const [wStr, hStr] = targetRatioStr.split(":");
				const tw = parseInt(wStr) || 9;
				const th = parseInt(hStr) || 16;
				
				const subject = action.params.subject as string | undefined;

				const tracks = editor.timeline.getTracks();
				for (const track of tracks) {
					for (const el of track.elements) {
						if (el.type === "video") {
							const media = editor.media.getAssetById(el.mediaId);
							if (media?.file) {
								const { computeReframeKeyframes, getDefaultReframeOptions } = await import("@/lib/reframe/reframe-types");
								const detection = await aiClient.detectFaces(media.file, { sampleInterval: 0.5, subject });
								
								const opts = {
									...getDefaultReframeOptions(),
									targetWidth: tw * 100, // proportional width
									targetHeight: th * 100, // proportional height
								};
								
								const keyframes = computeReframeKeyframes(detection, opts);
								
								const animations = { ...(el.animations || {}) };
								const channels = { ...(animations.channels || {}) };
								channels["transform.position.x"] = keyframes.positionX;
								channels["transform.position.y"] = keyframes.positionY;
								channels["transform.scale"] = keyframes.scale;
								animations.channels = channels;
								
								editor.timeline.updateElement(el.id, { animations });
							}
						}
					}
				}
			} catch (e) {
				console.error("[ai-action-executor] AUTO_REFRAME failed:", e);
			}
			break;
		}

		case "ADD_TRACK": {
			try {
				const editor = getEditorCore();
				const type = (action.params.type as any) || "video";
				editor.timeline.addTrack({ type });
			} catch (e) {
				console.error(e);
			}
			break;
		}

		case "REMOVE_TRACK": {
			try {
				const editor = getEditorCore();
				const trackId = action.params.trackId as string;
				if (trackId) editor.timeline.removeTrack({ trackId });
			} catch (e) {
				console.error(e);
			}
			break;
		}

		case "SET_TRACK_STATE": {
			try {
				const editor = getEditorCore();
				const trackId = action.params.trackId as string;
				if (trackId) {
					if (typeof action.params.muted === "boolean") {
						editor.timeline.toggleTrackMute({ trackId });
					}
					if (typeof action.params.hidden === "boolean") {
						editor.timeline.toggleTrackVisibility({ trackId });
					}
				}
			} catch (e) {
				console.error(e);
			}
			break;
		}

		case "DELETE_CLIPS": {
			try {
				const editor = getEditorCore();
				const clipIds = action.params.clipIds as string[];
				if (clipIds && clipIds.length > 0) {
					editor.timeline.deleteElements({ elementIds: clipIds });
				}
			} catch (e) {
				console.error(e);
			}
			break;
		}

		case "DUPLICATE_CLIPS": {
			try {
				const editor = getEditorCore();
				const clipIds = action.params.clipIds as string[];
				if (clipIds && clipIds.length > 0) {
					editor.timeline.duplicateElements({ elementIds: clipIds });
				}
			} catch (e) {
				console.error(e);
			}
			break;
		}

		case "MOVE_CLIP": {
			try {
				const editor = getEditorCore();
				const clipId = action.params.clipId as string;
				const newTrackId = action.params.trackId as string | undefined;
				const newStartTime = action.params.startTime as number | undefined;
				if (clipId) {
					const tracks = editor.timeline.getTracks();
					let foundTrackId = newTrackId;
					if (!foundTrackId) {
						for (const t of tracks) {
							if (t.elements.some((e: any) => e.id === clipId)) {
								foundTrackId = t.id;
								break;
							}
						}
					}
					if (foundTrackId && newStartTime !== undefined) {
						editor.timeline.moveElement({ elementId: clipId, newTrackId: foundTrackId, newStartTime });
					}
				}
			} catch (e) {
				console.error(e);
			}
			break;
		}

		case "UPDATE_TRANSFORM":
		case "UPDATE_VOLUME":
		case "UPDATE_TEXT": {
			try {
				const editor = getEditorCore();
				const clipIds = action.params.clipIds as string[];
				if (clipIds && clipIds.length > 0) {
					const tracks = editor.timeline.getTracks();
					for (const track of tracks) {
						for (const el of track.elements) {
							if (clipIds.includes(el.id)) {
								const updates: any = {};
								if (action.type === "UPDATE_TRANSFORM") {
									const transform: any = { ...((el as any).transform || {}) };
									if (typeof action.params.scale === "number") transform.scale = action.params.scale;
									if (typeof action.params.x === "number") transform.x = action.params.x;
									if (typeof action.params.y === "number") transform.y = action.params.y;
									if (typeof action.params.rotation === "number") transform.rotation = action.params.rotation;
									updates.transform = transform;
									if (typeof action.params.opacity === "number") updates.opacity = action.params.opacity;
								} else if (action.type === "UPDATE_VOLUME") {
									if (typeof action.params.volume === "number") updates.volume = action.params.volume;
									if (typeof action.params.muted === "boolean") updates.muted = action.params.muted;
								} else if (action.type === "UPDATE_TEXT") {
									if (typeof action.params.text === "string") updates.content = action.params.text;
									if (typeof action.params.fontSize === "number") updates.fontSize = action.params.fontSize;
									if (typeof action.params.fontFamily === "string") updates.fontFamily = action.params.fontFamily;
									if (typeof action.params.color === "string") updates.color = action.params.color;
									if (typeof action.params.textAlign === "string") updates.textAlign = action.params.textAlign;
								}
								
								if (Object.keys(updates).length > 0) {
									editor.timeline.updateElements({
										updates: [{
											trackId: track.id,
											elementId: el.id,
											updates
										}]
									});
								}
							}
						}
					}
				}
			} catch (e) {
				console.error(e);
			}
			break;
		}

		case "ADD_STICKER_OVERLAY": {
			try {
				const editor = getEditorCore();
				const stickerId = action.params.stickerId as string;
				const startTime = (action.params.startTime as number) || 0;
				const duration = (action.params.duration as number) || 3;
				if (stickerId) {
					const trackId = editor.timeline.addTrack({ type: "sticker" });
					editor.timeline.insertElement({
						element: {
							type: "sticker",
							name: "Sticker",
							stickerId,
							startTime,
							duration,
							trimStart: 0,
							trimEnd: 0,
							transform: {
								scale: (action.params.scale as number) || 1,
								position: {
									x: (action.params.x as number) || 0,
									y: (action.params.y as number) || 0
								},
								rotate: 0
							},
							opacity: 1
						} as any,
						placement: { mode: "explicit", trackId }
					});
				}
			} catch (e) {
				console.error(e);
			}
			break;
		}

		case "UPDATE_PROJECT_SETTINGS": {
			try {
				const editor = getEditorCore();
				const settings: any = {};
				if (typeof action.params.width === "number") settings.canvasSize = { width: action.params.width, height: action.params.height || action.params.width };
				if (typeof action.params.fps === "number") settings.fps = action.params.fps;
				if (typeof action.params.backgroundColor === "string") settings.backgroundColor = action.params.backgroundColor;
				if (typeof action.params.proxyEditing === "boolean") settings.proxyEditing = action.params.proxyEditing;
				if (Object.keys(settings).length > 0) {
					editor.project.updateSettings({ settings });
				}
			} catch (e) {
				console.error(e);
			}
			break;
		}

		case "ADD_KEYFRAME": {
			try {
				const editor = getEditorCore();
				const clipId = action.params.clipId as string;
				const property = action.params.property as any;
				const time = action.params.time as number;
				const value = action.params.value as any;
				if (clipId && property && time !== undefined && value !== undefined) {
					const tracks = editor.timeline.getTracks();
					for (const track of tracks) {
						for (const el of track.elements) {
							if (el.id === clipId) {
								editor.timeline.upsertKeyframe({
									trackId: track.id,
									elementId: clipId,
									property,
									time,
									value
								});
							}
						}
					}
				}
			} catch (e) {
				console.error(e);
			}
			break;
		}

		default:
			console.warn(`[ai-action-executor] Unknown action type: ${action.type}`);
	}
}

export async function executeActions(actions: EditorAction[]): Promise<void> {
	for (const action of actions) {
		await executeAction(action);
	}
}
