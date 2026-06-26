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

	if (tool === "EXECUTE_ACTION") {
		if (!params || !params.type) {
			return "Error: missing 'type' parameter for EXECUTE_ACTION.";
		}
		try {
			const { executeAction } = require("@/lib/ai-action-executor");
			// executeAction expects { type: "...", params: {...} }
			await executeAction(params);
			return `Successfully executed ${params.type}. You can use GET_TIMELINE_STATE to verify the changes.`;
		} catch (err: any) {
			return `Error executing action ${params.type}: ${err.message || err}`;
		}
	}

	return `Unknown tool: ${tool}`;
}

/**
 * Normalise any vendor-specific tool-call syntax the LLM might emit into the
 * internal ```json tool-call … ``` format the loop already parses.
 *
 * Handles:
 *   • <minimax:tool_call><invoke name="TOOL">…</invoke></minimax:tool_call>
 *   • <invoke name="TOOL"><parameter name="key">val</parameter></invoke>
 *   • <tool_call>{"name":"TOOL","arguments":{…}}</tool_call>
 *   • {"name":"TOOL","arguments":{…}} bare JSON objects (no fences)
 *   • {"function":{"name":"TOOL","arguments":{…}}} OpenAI delta objects
 *   • Plain text XML: <TOOL_NAME><key>val</key></TOOL_NAME>
 */
function normalizeToolCallFormats(text: string): string {
	// ── 1. minimax:tool_call / generic XML wrapper ──────────────────────────
	// <minimax:tool_call><invoke name="LIST_MEDIA"></invoke></minimax:tool_call>
	// <tool_call>JSON</tool_call>
	const xmlWrapperRe = /<(?:minimax:)?tool_call[^>]*>([\s\S]*?)<\/(?:minimax:)?tool_call>/i;
	const xmlWrapperMatch = text.match(xmlWrapperRe);
	if (xmlWrapperMatch) {
		const inner = xmlWrapperMatch[1].trim();
		// Inner might be <invoke name="…">…</invoke> or raw JSON
		const invokeRe = /<invoke[^>]*\sname="([^"]+)"[^>]*>([\s\S]*?)<\/invoke>/i;
		const invokeMatch = inner.match(invokeRe);
		if (invokeMatch) {
			const toolName = invokeMatch[1];
			const paramsXml = invokeMatch[2].trim();
			const params = parseXmlParams(paramsXml);
			const before = text.slice(0, text.indexOf(xmlWrapperMatch[0])).trimEnd();
			const after = text.slice(text.indexOf(xmlWrapperMatch[0]) + xmlWrapperMatch[0].length).trimStart();
			const fence = "```json tool-call\n" + JSON.stringify({ tool: toolName, params }) + "\n```";
			return [before, fence, after].filter(Boolean).join("\n");
		}
		// inner is raw JSON: {"name":"TOOL","arguments":{}}
		try {
			const parsed = JSON.parse(inner);
			const toolName = parsed.name || parsed.tool;
			const params = parsed.arguments || parsed.params || {};
			if (toolName) {
				const before = text.slice(0, text.indexOf(xmlWrapperMatch[0])).trimEnd();
				const after = text.slice(text.indexOf(xmlWrapperMatch[0]) + xmlWrapperMatch[0].length).trimStart();
				const fence = "```json tool-call\n" + JSON.stringify({ tool: toolName, params }) + "\n```";
				return [before, fence, after].filter(Boolean).join("\n");
			}
		} catch { /* fall through */ }
	}

	// ── 2. bare <invoke name="…"> without outer wrapper ─────────────────────
	const bareInvokeRe = /<invoke[^>]*\sname="([^"]+)"[^>]*>([\s\S]*?)<\/invoke>/i;
	const bareInvokeMatch = text.match(bareInvokeRe);
	if (bareInvokeMatch) {
		const toolName = bareInvokeMatch[1];
		const paramsXml = bareInvokeMatch[2].trim();
		const params = parseXmlParams(paramsXml);
		const before = text.slice(0, text.indexOf(bareInvokeMatch[0])).trimEnd();
		const after = text.slice(text.indexOf(bareInvokeMatch[0]) + bareInvokeMatch[0].length).trimStart();
		const fence = "```json tool-call\n" + JSON.stringify({ tool: toolName, params }) + "\n```";
		return [before, fence, after].filter(Boolean).join("\n");
	}

	// ── 3. OpenAI function-call delta: {"function":{"name":"X","arguments":"{}"}} ─
	// Only when the ENTIRE response (trimmed) is such an object
	const trimmed = text.trim();
	if (trimmed.startsWith("{") && trimmed.endsWith("}") && !text.includes("```")) {
		try {
			const parsed = JSON.parse(trimmed);
			// OpenAI delta shape
			if (parsed.function?.name) {
				const args = typeof parsed.function.arguments === "string"
					? JSON.parse(parsed.function.arguments || "{}")
					: (parsed.function.arguments || {});
				return "```json tool-call\n" + JSON.stringify({ tool: parsed.function.name, params: args }) + "\n```";
			}
			// Anthropic tool_use shape: { type:"tool_use", name:"X", input:{} }
			if (parsed.type === "tool_use" && parsed.name) {
				return "```json tool-call\n" + JSON.stringify({ tool: parsed.name, params: parsed.input || {} }) + "\n```";
			}
			// Plain {"name":"X","arguments":{}}
			if ((parsed.name || parsed.tool) && !parsed.steps) {
				const toolName = parsed.name || parsed.tool;
				const params = parsed.arguments || parsed.params || parsed.input || {};
				return "```json tool-call\n" + JSON.stringify({ tool: toolName, params }) + "\n```";
			}
		} catch { /* fall through */ }
	}

	// ── 4. Nothing matched — return unchanged ─────────────────────────────────
	return text;
}

/** Parse simple <key>value</key> parameter blocks into a plain object. */
function parseXmlParams(xml: string): Record<string, unknown> {
	const params: Record<string, unknown> = {};
	const paramRe = /<parameter\s+name="([^"]+)">([^<]*)<\/parameter>|<([a-zA-Z_][a-zA-Z0-9_]*)>([^<]*)<\/\3>/g;
	let m: RegExpExecArray | null;
	while ((m = paramRe.exec(xml)) !== null) {
		const key = m[1] || m[3];
		const rawVal = m[2] ?? m[4] ?? "";
		const val = rawVal.trim();
		// coerce numerics / booleans
		if (val === "true") params[key] = true;
		else if (val === "false") params[key] = false;
		else if (val !== "" && !isNaN(Number(val))) params[key] = Number(val);
		else params[key] = val;
	}
	return params;
}

export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
	const {
		goal,
		systemPrompt,
		editor,
		onToken,
		onToolCall,
		maxIterations = 50,
		history = [],
	} = options;

	const messages: Array<{ role: string; content: string }> = [];

	// Carry over last N messages (e.g. 10 messages) for multi-turn context
	if (history.length > 0) {
		messages.push(...history.slice(-10));
	}

	// Add user goal with structured ReAct instructions
	messages.push({
		role: "user",
		content: `Goal: ${goal}\n\nBegin your Thought → Action loop. If you need project information, call a tool first. When ready, output your final copilot-plan.`,
	});

	let iterations = 0;
	let lastOutput = "";
	let hasRetriedJSON = false;

	// Stuck-loop detection: track last tool call to detect repeated identical calls
	let lastToolKey = "";
	let consecutiveRepeatCount = 0;

	while (iterations < maxIterations) {
		iterations++;
		let accumulated = "";

		// Context window trimming: if messages exceed 40 entries, summarize older turns
		// to prevent context overflow while preserving recent tool results
		if (messages.length > 40) {
			const systemMsgs = messages.filter(m => m.role === "system");
			const recentMessages = messages.slice(-20);
			const trimmedCount = messages.length - 20 - systemMsgs.length;
			const summary = {
				role: "user" as const,
				content: `[CONTEXT_SUMMARY] ${trimmedCount} earlier messages were trimmed. The conversation has been ongoing for ${iterations - 1} turns. Continue from where you left off — gather any remaining info or produce your final copilot-plan.`,
			};
			messages.length = 0;
			messages.push(...systemMsgs, summary, ...recentMessages);
		}

		const result = await aiClient.chatStream(
			messages,
			(token, acc) => {
				accumulated = acc;
				onToken(token, iterations);
			},
			systemPrompt,
		);

		const rawResponse = result.response || accumulated;
		// Normalise any vendor-specific tool-call XML/JSON into our internal
		// ` ```json tool-call ``` ` format before further processing.
		const responseText = normalizeToolCallFormats(rawResponse);
		lastOutput = responseText;

		// Check for tool calls
		const toolMatch = responseText.match(/```json tool-call\s*([\s\S]*?)\s*```/);
		if (toolMatch) {
			try {
				const toolCall = JSON.parse(toolMatch[1]);
				const toolName = toolCall.tool;
				const params = toolCall.params || {};

				// Stuck-loop detection: check if this is the same tool+params as last turn
				const toolKey = JSON.stringify({ tool: toolName, params });
				if (toolKey === lastToolKey) {
					consecutiveRepeatCount++;
					if (consecutiveRepeatCount >= 2) {
						// Break the stuck loop by nudging the model
						messages.push({ role: "assistant", content: responseText });
						messages.push({
							role: "user",
							content: `[SYSTEM_NOTICE] You have called "${toolName}" with identical parameters ${consecutiveRepeatCount + 1} times in a row. The result will be the same. Please either: (a) call a DIFFERENT tool or with different parameters, or (b) produce your final copilot-plan based on the information you already have.`,
						});
						consecutiveRepeatCount = 0;
						lastToolKey = "";
						continue;
					}
				} else {
					consecutiveRepeatCount = 0;
				}
				lastToolKey = toolKey;

				onToolCall(toolName, params, iterations);

				const toolResult = await executeTool(toolName, params, editor);

				// Tool results sent as role:"user" with clear framing so models
				// don't ignore/deprioritize them (some models treat "system" messages
				// as lower priority or strip them in certain contexts)
				messages.push({ role: "assistant", content: responseText });
				messages.push({ role: "user", content: `[TOOL_RESULT] Tool "${toolName}" returned:\n${toolResult}\n\nContinue your Thought → Action loop. Analyze the result above and decide your next step.` });
				continue;
			} catch (err: any) {
				const errorMsg = `Error parsing or executing tool: ${err.message || err}`;
				messages.push({ role: "assistant", content: responseText });
				messages.push({ role: "user", content: `[TOOL_ERROR] ${errorMsg}\n\nPlease fix the tool call or try a different approach.` });
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
						role: "user",
						content: `[JSON_ERROR] Failed to parse your copilot-plan: ${e.message || e}.\n\nPlease output ONLY a valid JSON copilot-plan block. Make sure all JSON is properly formatted with correct brackets and quotes.`,
					});
					continue;
				}
			}
		}

		// If no tool call and no valid copilot-plan was parsed, we assume it's a conversational response and exit
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

