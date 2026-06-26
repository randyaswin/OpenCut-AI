import { aiClient } from "@/lib/ai-client";
import { useTranscriptStore } from "@/stores/transcript-store";
import type { CopilotPlan, CopilotStep, CopilotStepStatus } from "./copilot-types";
import { isDestructiveAction } from "@/lib/ai-action-executor";
import { getAllEmbeddings } from "@/services/search/embedding-store";

export interface AgentLoopOptions {
	goal: string;
	systemPrompt: string;
	editor: any;
	onToken: (token: string, turn: number) => void;
	onToolCall: (toolName: string, params: any, turn: number) => void;
	maxIterations?: number;
	history?: Array<{ role: string; content: string }>;
}

export interface AgentLoopResult {
	plan: CopilotPlan | null;
	rawOutput: string;
	iterations: number;
}

function dotProduct(a: Float32Array, b: Float32Array): number {
	let sum = 0;
	const n = Math.min(a.length, b.length);
	for (let i = 0; i < n; i++) sum += a[i] * b[i];
	return sum;
}

async function executeTool(tool: string, params: any, editor: any): Promise<string> {
	if (tool === "LIST_MEDIA") {
		const assets = editor.media.getAssets().map((a: any) => ({
			id: a.id,
			name: a.name,
			type: a.type,
			duration: a.duration,
		}));
		return JSON.stringify(assets, null, 2);
	}

	if (tool === "GET_MEDIA_METADATA") {
		const assetId = params?.assetId;
		if (!assetId) {
			return "Error: assetId parameter is missing.";
		}
		try {
			const res = await fetch("/api/assets/metadata/batch", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ assetIds: [assetId] }),
			});
			if (res.ok) {
				const raw = await res.json();
				if (raw[assetId]) {
					const clean = { ...raw[assetId] };
					delete clean.metadata; // remove bulky raw ffprobe data
					return JSON.stringify(clean, null, 2);
				}
				return "No semantic metadata found for this asset.";
			}
			return `Failed to fetch metadata. Server responded with status ${res.status}`;
		} catch (err: any) {
			return `Error fetching metadata: ${err.message || err}`;
		}
	}

	if (tool === "GET_TIMELINE_STATE") {
		const tracks = editor.timeline.getTracks();
		const segments = useTranscriptStore.getState().segments;
		const chapters = useTranscriptStore.getState().chapters;
		const project = editor.project.getActiveOrNull();
		const state = {
			duration: project?.metadata?.duration ?? 0,
			trackCount: tracks.length,
			tracks: tracks.map((t: any) => ({
				type: t.type,
				elementCount: t.elements.length,
				elements: t.elements.map((el: any) => ({
					type: el.type,
					name: el.name ?? "",
					startTime: el.startTime,
					duration: el.duration,
				})),
			})),
			segmentCount: segments.length,
			chapterCount: chapters.length,
		};
		return JSON.stringify(state, null, 2);
	}

	if (tool === "SEARCH_MEDIA") {
		const query = params?.query;
		if (!query) {
			return "Error: query parameter is missing.";
		}
		try {
			const all = await getAllEmbeddings();
			if (all.length === 0) {
				return "No media files have been indexed yet.";
			}
			const queryVec = Float32Array.from((await aiClient.embedText(query)).vector);
			const assets = editor.media.getAssets();
			const byId = new Map(assets.map((a: any) => [a.id, a]));

			const candidates = [];
			for (const media of all) {
				const asset = byId.get(media.mediaId) as any;
				if (!asset) continue;
				let bestScore = -Infinity;
				let bestTs = 0;
				for (const frame of media.frames) {
					const score = dotProduct(queryVec, frame.vector);
					if (score > bestScore) {
						bestScore = score;
						bestTs = frame.timestampSec;
					}
				}
				if (bestScore >= 0.18) {
					candidates.push({
						mediaId: media.mediaId,
						timestampSec: bestTs,
						score: bestScore,
						name: asset.name,
						type: asset.type,
					});
				}
			}
			candidates.sort((a, b) => b.score - a.score);
			return JSON.stringify(candidates.slice(0, 10), null, 2);
		} catch (err: any) {
			return `Error searching media: ${err.message || err}`;
		}
	}

	if (tool === "DETECT_SCENES") {
		const assetId = params?.assetId;
		if (!assetId) {
			return "Error: assetId parameter is missing.";
		}
		try {
			const res = await fetch("/api/assets/metadata/batch", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ assetIds: [assetId] }),
			});
			if (res.ok) {
				const raw = await res.json();
				if (raw[assetId] && raw[assetId].scenes && raw[assetId].scenes.length > 0) {
					return JSON.stringify(raw[assetId].scenes, null, 2);
				}
				return "No scene descriptions found in database for this asset.";
			}
			return `Failed to fetch scenes. Status: ${res.status}`;
		} catch (err: any) {
			return `Error during scene retrieval: ${err.message || err}`;
		}
	}

	if (tool === "GET_TRANSCRIPT") {
		const assetId = params?.assetId;
		if (!assetId) {
			return "Error: assetId parameter is missing.";
		}
		try {
			const res = await fetch("/api/assets/metadata/batch", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ assetIds: [assetId] }),
			});
			if (res.ok) {
				const raw = await res.json();
				if (raw[assetId] && raw[assetId].transcripts && raw[assetId].transcripts.length > 0) {
					return JSON.stringify(raw[assetId].transcripts, null, 2);
				}
			}
			// Fallback: transcribe on demand if possible
			const asset = editor.media.getAssets().find((a: any) => a.id === assetId);
			if (asset?.file) {
				const transcriptResult = await aiClient.transcribe(asset.file);
				return JSON.stringify(transcriptResult.segments, null, 2);
			}
			return "No transcript or local media file found to transcribe.";
		} catch (err: any) {
			return `Error fetching transcript: ${err.message || err}`;
		}
	}

	if (tool === "ANALYZE_AUDIO") {
		const assetId = params?.assetId;
		if (!assetId) {
			return "Error: assetId parameter is missing.";
		}
		try {
			const asset = editor.media.getAssets().find((a: any) => a.id === assetId);
			if (asset?.file) {
				const silenceResult = await aiClient.analyzeSilences(asset.file);
				return JSON.stringify(silenceResult.silences, null, 2);
			}
			return "Media asset file not found locally.";
		} catch (err: any) {
			return `Error analyzing audio: ${err.message || err}`;
		}
	}

	if (tool === "SUGGEST_MUSIC") {
		const mood = params?.mood || "ambient";
		try {
			const res = await fetch(`/api/sounds/search?q=${encodeURIComponent(mood)}&type=songs`);
			if (res.ok) {
				const raw = await res.json();
				const results = raw.results || [];
				return JSON.stringify(results.slice(0, 3).map((r: any) => ({
					id: r.id,
					name: r.name,
					previewUrl: r.previewUrl,
					duration: r.duration,
				})), null, 2);
			}
			return `Failed to fetch music suggestions. Status: ${res.status}`;
		} catch (err: any) {
			return `Error suggesting music: ${err.message || err}`;
		}
	}

	return `Unknown tool: ${tool}`;
}

export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
	const {
		goal,
		systemPrompt,
		editor,
		onToken,
		onToolCall,
		maxIterations = 8,
		history = [],
	} = options;

	const messages: Array<{ role: string; content: string }> = [];

	// Carry over last N messages (e.g. 10 messages) for multi-turn context
	if (history.length > 0) {
		messages.push(...history.slice(-10));
	}

	// Add user goal
	messages.push({
		role: "user",
		content: `Goal: ${goal}\n\nYou can query the project library or timeline using tools if needed. Otherwise, output your final copilot-plan directly.`,
	});

	let iterations = 0;
	let lastOutput = "";
	let hasRetriedJSON = false;

	while (iterations < maxIterations) {
		iterations++;
		let accumulated = "";

		const result = await aiClient.chatStream(
			messages,
			(token, acc) => {
				accumulated = acc;
				onToken(token, iterations);
			},
			systemPrompt,
		);

		const responseText = result.response || accumulated;
		lastOutput = responseText;

		// Check for tool calls
		const toolMatch = responseText.match(/```json tool-call\s*([\s\S]*?)\s*```/);
		if (toolMatch) {
			try {
				const toolCall = JSON.parse(toolMatch[1]);
				const toolName = toolCall.tool;
				const params = toolCall.params || {};

				onToolCall(toolName, params, iterations);

				const toolResult = await executeTool(toolName, params, editor);

				// Preserving history in message format
				messages.push({ role: "assistant", content: responseText });
				messages.push({ role: "system", content: `Tool Result:\n${toolResult}` });
				continue;
			} catch (err: any) {
				const errorMsg = `Error parsing or executing tool: ${err.message || err}`;
				messages.push({ role: "assistant", content: responseText });
				messages.push({ role: "system", content: `Tool Result:\n${errorMsg}` });
				continue;
			}
		}

		// Check for copilot-plan
		const planMatch = responseText.match(/```(?:json\s+copilot-plan|json)\s*([\s\S]*?)\s*```/);
		const jsonStr = planMatch ? planMatch[1] : responseText.match(/\{[\s\S]*\}/)?.[0];

		if (jsonStr) {
			try {
				const parsed = JSON.parse(jsonStr);
				if (parsed.steps) {
					const steps: CopilotStep[] = parsed.steps.map((s: any, i: number) => ({
						id: s.id ?? `step-${i + 1}`,
						description: s.description ?? `Step ${i + 1}`,
						action: s.action,
						status: "pending" as CopilotStepStatus,
					}));

					const hasDestructive = steps.some(s => s.action && isDestructiveAction(s.action.type));

					const plan: CopilotPlan = {
						goal,
						steps,
						estimatedTime: parsed.estimatedTime ?? "A few minutes",
						requiresConfirmation: hasDestructive || (parsed.requiresConfirmation ?? true),
					};

					return { plan, rawOutput: responseText, iterations };
				}
			} catch (e: any) {
				// Retry/correction logic for malformed JSON
				if (!hasRetriedJSON) {
					hasRetriedJSON = true;
					messages.push({ role: "assistant", content: responseText });
					messages.push({
						role: "system",
						content: `Error parsing JSON plan: ${e.message || e}. Please output ONLY a valid JSON copilot-plan.`,
					});
					continue;
				}
			}
		}

		// If no tool call and no valid copilot-plan was parsed, we exit
		break;
	}

	// Try one last attempt to extract JSON plan from the last output in case we hit iteration limit
	try {
		const planMatch = lastOutput.match(/```(?:json\s+copilot-plan|json)\s*([\s\S]*?)\s*```/);
		const jsonStr = planMatch ? planMatch[1] : lastOutput.match(/\{[\s\S]*\}/)?.[0];
		if (jsonStr) {
			const parsed = JSON.parse(jsonStr);
			if (parsed.steps) {
				const steps: CopilotStep[] = parsed.steps.map((s: any, i: number) => ({
					id: s.id ?? `step-${i + 1}`,
					description: s.description ?? `Step ${i + 1}`,
					action: s.action,
					status: "pending" as CopilotStepStatus,
				}));
				const hasDestructive = steps.some(s => s.action && isDestructiveAction(s.action.type));
				const plan: CopilotPlan = {
					goal,
					steps,
					estimatedTime: parsed.estimatedTime ?? "A few minutes",
					requiresConfirmation: hasDestructive || (parsed.requiresConfirmation ?? true),
				};
				return { plan, rawOutput: lastOutput, iterations };
			}
		}
	} catch {}

	return { plan: null, rawOutput: lastOutput, iterations };
}
