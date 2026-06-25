import { aiClient } from "@/lib/ai-client";
import { useTranscriptStore } from "@/stores/transcript-store";
import type { CopilotPlan, CopilotStep, CopilotStepStatus } from "./copilot-types";
import { isDestructiveAction } from "@/lib/ai-action-executor";

export interface AgentLoopOptions {
	goal: string;
	systemPrompt: string;
	editor: any;
	onToken: (token: string, turn: number) => void;
	onToolCall: (toolName: string, params: any, turn: number) => void;
	maxIterations?: number;
}

export interface AgentLoopResult {
	plan: CopilotPlan | null;
	rawOutput: string;
	iterations: number;
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
	} = options;

	let currentPrompt = `Goal: ${goal}\n\nYou can query the project library or timeline using tools if needed. Otherwise, output your final copilot-plan directly.`;
	let iterations = 0;
	let lastOutput = "";

	while (iterations < maxIterations) {
		iterations++;
		let accumulated = "";

		const result = await aiClient.chatStream(
			currentPrompt,
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

				// Build prompt for next iteration, preserving conversation history
				currentPrompt = `${currentPrompt}\n\nAssistant:\n${responseText}\n\nSystem: Tool Result:\n${toolResult}\n\nAssistant:\n`;
				continue;
			} catch (err: any) {
				const errorMsg = `Error parsing or executing tool: ${err.message || err}`;
				currentPrompt = `${currentPrompt}\n\nAssistant:\n${responseText}\n\nSystem: Tool Result:\n${errorMsg}\n\nAssistant:\n`;
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
			} catch {}
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
