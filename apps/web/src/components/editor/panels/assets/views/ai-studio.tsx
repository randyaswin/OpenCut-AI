"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { cn } from "@/utils/ui";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	SparklesIcon,
	SentIcon,
	AiMicIcon,
	TextIcon,
	Image01Icon,
	ArrowRight01Icon,
	Bookmark01Icon,
	Delete02Icon,
} from "@hugeicons/core-free-icons";
import { aiClient } from "@/lib/ai-client";
import { useAIStatus } from "@/hooks/use-ai-status";
import { useAIStore, type StudioMessage } from "@/stores/ai-store";
import { useTranscriptStore } from "@/stores/transcript-store";
import { toast } from "sonner";
import { useEditor } from "@/hooks/use-editor";
import { COPILOT_SYSTEM_PROMPT, type CopilotPlan } from "@/lib/copilot/copilot-types";
import { runAgentLoop } from "@/lib/copilot/agent-loop";
import { executeAction, previewAction } from "@/lib/ai-action-executor";
import { TemplatePanel } from "@/components/editor/ai/template-panel";
import { BRollSuggestionsPanel } from "@/components/editor/ai/broll-suggestions-panel";
import { YouTubeReelsPanel } from "@/components/editor/youtube/youtube-reels-panel";
import { AIDubbingPanel } from "@/components/editor/panels/assets/views/ai-dubbing";
import { AutoChaptersPanel } from "@/components/editor/panels/assets/views/auto-chapters";
import { SmartReframePanel } from "@/components/editor/panels/assets/views/smart-reframe";
import { MotionTrackingPanel } from "@/components/editor/panels/assets/views/motion-tracking";
import { ABTestingPanel } from "@/components/editor/panels/assets/views/ab-testing";
import { ChatMessage } from "@/components/editor/ai/chat-message";

function stripJSON(text: string): string {
	let cleaned = text;

	// 1. Handle unclosed markdown code blocks at the end of the text
	const lastTripleBacktick = cleaned.lastIndexOf("```");
	if (lastTripleBacktick !== -1) {
		const after = cleaned.slice(lastTripleBacktick + 3);
		if (!after.includes("```")) {
			// If it's an unclosed code block, check if it's a JSON block or contains JSON-like content
			if (after.match(/^(?:json|\s*\{|\s*\[)/i) || after.includes('"') || after.includes(':')) {
				cleaned = cleaned.slice(0, lastTripleBacktick);
			} else {
				// Just auto-close it so standard regex can clean it up or process it
				cleaned += "\n```";
			}
		}
	}

	// 2. Strip closed markdown code blocks that contain JSON or tool calls
	cleaned = cleaned.replace(/```(?:json\s+[\w-]+|json)?\s*([\s\S]*?)```/g, (match, p1) => {
		const trimmed = p1.trim();
		if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
			return "";
		}
		if (trimmed.includes('"') && trimmed.includes(':')) {
			return "";
		}
		return match;
	});

	// 3. Scan for JSON objects/arrays (both closed and unclosed at the end)
	let result = "";
	let i = 0;
	while (i < cleaned.length) {
		if (cleaned[i] === "{" || cleaned[i] === "[") {
			const startChar = cleaned[i];
			const endChar = startChar === "{" ? "}" : "]";
			let braceCount = 1;
			let j = i + 1;
			let inString = false;
			let escaped = false;
			
			while (j < cleaned.length && braceCount > 0) {
				const char = cleaned[j];
				if (escaped) {
					escaped = false;
				} else if (char === "\\") {
					escaped = true;
				} else if (char === '"') {
					inString = !inString;
				} else if (!inString) {
					if (char === startChar) {
						braceCount++;
					} else if (char === endChar) {
						braceCount--;
					}
				}
				j++;
			}
			
			if (braceCount === 0) {
				// Found a matching closed block. Check if it's JSON
				const candidate = cleaned.slice(i, j);
				let isJSON = false;
				try {
					JSON.parse(candidate);
					isJSON = true;
				} catch {
					const trimmed = candidate.trim();
					if (trimmed.includes('"') && trimmed.includes(':')) {
						isJSON = true;
					}
				}
				if (isJSON) {
					i = j;
					continue;
				}
			} else {
				// Unclosed block at the end of the text.
				// If it contains typical JSON markers (like colons, quotes, or starts with known keys/brackets),
				// strip it from this point to the end.
				const remaining = cleaned.slice(i);
				if (remaining.includes('"') || remaining.includes(':') || remaining.includes(',') || remaining.length > 5) {
					break; // Stop including anything from i onwards
				}
			}
		}
		result += cleaned[i];
		i++;
	}

	return result.trim();
}

// ----- Thinking Messages -----

const THINKING_MESSAGES = [
	"Rewinding the creative tape...",
	"Adjusting the white balance on this idea...",
	"Adding a dramatic zoom to my thoughts...",
	"Scrubbing through the timeline of possibilities...",
	"Applying a smooth transition between neurons...",
	"Color grading this response for maximum impact...",
	"Removing the awkward silence from my thinking...",
	"Adding B-roll to my train of thought...",
	"Stabilizing this shaky idea...",
	"Rendering a rough cut of my answer...",
	"Trimming the fat, keeping the hook...",
	"Keyframing the perfect response...",
	"De-noising my thought process...",
	"Jump cutting to the good part...",
	"Pulling focus on what matters...",
	"Adding a lens flare for dramatic effect...",
	"Speed ramping through the boring bits...",
	"Checking if this take is a keeper...",
	"Syncing audio with my brainwaves...",
	"Applying the viral filter to this answer...",
];

function useThinkingMessage(isThinking: boolean) {
	const [index, setIndex] = useState(() => Math.floor(Math.random() * THINKING_MESSAGES.length));

	useEffect(() => {
		if (!isThinking) return;
		// Pick a random starting message each time thinking begins
		setIndex(Math.floor(Math.random() * THINKING_MESSAGES.length));

		const interval = setInterval(() => {
			setIndex((prev) => (prev + 1) % THINKING_MESSAGES.length);
		}, 3000);

		return () => clearInterval(interval);
	}, [isThinking]);

	return THINKING_MESSAGES[index];
}

async function buildProjectContext(editor: ReturnType<typeof useEditor>) {
	const tracks = editor.timeline.getTracks();
	const segments = useTranscriptStore.getState().segments;
	const chapters = useTranscriptStore.getState().chapters;
	const project = editor.project.getActiveOrNull();

	const assetIds = editor.media.getAssets().map(a => a.id);
	let richMetadata = {};


	return {
		duration: project?.metadata?.duration ?? 0,
		trackCount: tracks.length,
		tracks: tracks.map((t) => ({
			type: t.type,
			elementCount: t.elements.length,
			elements: t.elements.map((el) => ({
				type: el.type,
				name: (el as any).name ?? "",
				startTime: el.startTime,
				duration: el.duration,
			})),
		})),
		segmentCount: segments.length,
		chapterCount: chapters.length,
		settings: project?.settings,
		mediaLibrary: editor.media.getAssets().map((a) => {
			return {
				id: a.id,
				name: a.name,
				type: a.type,
				duration: a.duration,
			};
		}),
	};
}

function CopilotPlanBlock({ planStr }: { planStr: string }) {
	const [isExecuting, setIsExecuting] = useState(false);
	const [status, setStatus] = useState<"pending" | "running" | "completed" | "error">("pending");
	
	let plan: CopilotPlan | null = null;
	try {
		plan = JSON.parse(planStr);
	} catch (e) {
		return <div className="text-red-500 text-xs">Invalid plan format.</div>;
	}

	if (!plan?.steps?.length) {
		return null;
	}

	const handleExecute = async () => {
		setIsExecuting(true);
		setStatus("running");
		try {
			for (const step of plan!.steps) {
				if (step.action) {
					await executeAction(step.action);
				}
				await new Promise(r => setTimeout(r, 200));
			}
			setStatus("completed");
			toast.success("Plan executed successfully");
		} catch (error) {
			setStatus("error");
			toast.error("Execution failed", { description: error instanceof Error ? error.message : "Unknown error" });
		} finally {
			setIsExecuting(false);
		}
	};

	return (
		<div className="my-3 rounded-lg border bg-card p-3 shadow-sm">
			<div className="flex items-center justify-between mb-2">
				<div className="flex items-center gap-1.5">
					<HugeiconsIcon icon={SparklesIcon} className="size-4 text-primary" />
					<span className="text-xs font-semibold">Editing Plan</span>
				</div>
				<span className="text-[10px] text-muted-foreground">{plan.estimatedTime || "Quick edit"}</span>
			</div>
			
			<div className="space-y-1.5 mb-3">
				{plan.steps.map((step, i) => (
					<div key={i} className="flex items-start gap-2 text-xs bg-muted/30 p-2 rounded">
						<span className="text-muted-foreground shrink-0 mt-0.5">{i + 1}.</span>
						<div className="flex-1 min-w-0">
							<p className="font-medium text-foreground">{step.description}</p>
							{step.action && (
								<p className="text-[10px] text-muted-foreground mt-0.5 font-mono truncate">
									{previewAction(step.action)}
								</p>
							)}
						</div>
					</div>
				))}
			</div>

			<Button 
				size="sm" 
				className="w-full text-xs h-7"
				onClick={handleExecute}
				disabled={isExecuting || status === "completed"}
				variant={status === "completed" ? "secondary" : "default"}
			>
				{status === "running" && <Spinner className="size-3 mr-2" />}
				{status === "completed" ? "Executed" : "Execute Plan"}
			</Button>
		</div>
	);
}

// ----- Types -----

interface WorkflowStep {
	id: string;
	label: string;
	description: string;
	icon: typeof SparklesIcon;
	action: string;
	isCompleted?: boolean;
}

type StudioMode = "chat" | "workflow" | "transcript" | "templates" | "ideas" | "broll" | "youtube-reels" | "dubbing" | "chapters" | "reframe" | "tracking" | "ab-testing";

// ----- Workflow Steps -----

const VIDEO_WORKFLOWS: {
	id: string;
	title: string;
	description: string;
	steps: WorkflowStep[];
}[] = [
	{
		id: "youtube",
		title: "YouTube video",
		description: "Plan, script, and produce a YouTube video",
		steps: [
			{
				id: "brainstorm",
				label: "Brainstorm the idea",
				description:
					"Describe your topic and audience. AI helps refine your angle.",
				icon: SparklesIcon,
				action: "brainstorm",
			},
			{
				id: "outline",
				label: "Create an outline",
				description:
					"AI generates a structured outline with key points and timestamps.",
				icon: TextIcon,
				action: "outline",
			},
			{
				id: "script",
				label: "Write the script",
				description:
					"Turn the outline into a full script with intro, body, and CTA.",
				icon: TextIcon,
				action: "script",
			},
			{
				id: "record",
				label: "Record and import",
				description:
					"Record your video following the script, then import it here.",
				icon: AiMicIcon,
				action: "import",
			},
			{
				id: "transcribe",
				label: "Transcribe and edit",
				description:
					"Transcribe the recording, then edit text to edit video.",
				icon: AiMicIcon,
				action: "transcribe",
			},
			{
				id: "polish",
				label: "Polish with AI",
				description:
					"Remove fillers, silences, add subtitles, generate thumbnail.",
				icon: Image01Icon,
				action: "polish",
			},
		],
	},
	{
		id: "short",
		title: "Short-form content",
		description: "TikTok, Reels, or YouTube Shorts",
		steps: [
			{
				id: "hook",
				label: "Craft the hook",
				description:
					"AI helps write a 3-second hook that stops the scroll.",
				icon: SparklesIcon,
				action: "hook",
			},
			{
				id: "script",
				label: "Script the content",
				description:
					"Keep it tight — AI structures your message for 30-60 seconds.",
				icon: TextIcon,
				action: "script-short",
			},
			{
				id: "record",
				label: "Record vertically",
				description:
					"Film in 9:16 portrait mode following the script.",
				icon: AiMicIcon,
				action: "import",
			},
			{
				id: "edit",
				label: "Fast-cut edit",
				description:
					"Remove silences and filler for punchy pacing.",
				icon: SparklesIcon,
				action: "fast-edit",
			},
			{
				id: "subtitles",
				label: "Add bold subtitles",
				description:
					"Most viewers watch muted — add animated captions.",
				icon: TextIcon,
				action: "subtitles",
			},
		],
	},
	{
		id: "podcast",
		title: "Podcast episode",
		description: "Record, clean, and clip a podcast",
		steps: [
			{
				id: "plan",
				label: "Plan the episode",
				description:
					"AI helps structure topics, questions, and talking points.",
				icon: SparklesIcon,
				action: "plan-podcast",
			},
			{
				id: "import",
				label: "Import recording",
				description: "Import your podcast recording.",
				icon: AiMicIcon,
				action: "import",
			},
			{
				id: "clean",
				label: "Clean the audio",
				description:
					"Remove background noise and normalize levels.",
				icon: SparklesIcon,
				action: "clean-audio",
			},
			{
				id: "transcribe",
				label: "Transcribe and find clips",
				description:
					"Transcribe to easily navigate and find the best moments.",
				icon: TextIcon,
				action: "transcribe",
			},
			{
				id: "clip",
				label: "Create highlight clips",
				description:
					"AI identifies the best segments for social media clips.",
				icon: Image01Icon,
				action: "highlights",
			},
		],
	},
];

// ----- Chat Prompts -----

const STARTER_PROMPTS = [
	{
		label: "Help me plan a YouTube video about...",
		prompt: "Help me plan a YouTube video. I want to make a video about ",
	},
	{
		label: "Write a script for a 60-second reel",
		prompt:
			"Write a script for a 60-second vertical video/reel about ",
	},
	{
		label: "Give me 5 video ideas about...",
		prompt: "Give me 5 unique video content ideas about ",
	},
	{
		label: "Help me write a video intro",
		prompt:
			"Help me write a compelling 10-second video intro for a video about ",
	},
	{
		label: "Create an outline for a tutorial",
		prompt:
			"Create a detailed outline for a tutorial video about ",
	},
	{
		label: "Suggest a thumbnail concept",
		prompt:
			"Describe a compelling thumbnail concept for a video about ",
	},
];

const TRANSCRIPT_PROMPTS = [
	{
		label: "Make it more concise",
		prompt: "Rewrite this transcript to be more concise. Remove redundant phrases and tighten the language while keeping the same meaning:\n\n",
	},
	{
		label: "Make it more professional",
		prompt: "Rewrite this transcript in a more professional and polished tone:\n\n",
	},
	{
		label: "Simplify the language",
		prompt: "Rewrite this transcript using simpler, more accessible language that a general audience can understand:\n\n",
	},
	{
		label: "Add more energy",
		prompt: "Rewrite this transcript to be more engaging and energetic, with stronger hooks and more dynamic phrasing:\n\n",
	},
	{
		label: "Fix grammar and flow",
		prompt: "Fix any grammar issues and improve the flow of this transcript while keeping the original meaning:\n\n",
	},
	{
		label: "Summarize key points",
		prompt: "Summarize the key points from this transcript in bullet points:\n\n",
	},
];

const QUICK_ACTIONS = [
	{ label: "🎬 Remove silences", prompt: "Detect and remove silent segments from the timeline." },
	{ label: "📝 Add subtitles", prompt: "Create and add a subtitle track for the current video." },
	{ label: "🎵 Add music", prompt: "Search and add a suitable background music track." },
	{ label: "✨ Enhance audio", prompt: "Denoise and normalize the audio of the active track." },
];

const EMPTY_MESSAGES: StudioMessage[] = [];

// ----- Component -----

export function AIStudioView() {
	const { isConnected } = useAIStatus();
	const toggleSetupGuide = useAIStore((s) => s.toggleSetupGuide);
	const saveIdea = useAIStore((s) => s.saveIdea);
	const savedIdeas = useAIStore((s) => s.savedIdeas);
	const removeIdea = useAIStore((s) => s.removeIdea);
	const clearIdeas = useAIStore((s) => s.clearIdeas);
	const editor = useEditor();
	const project = editor.project.getActiveOrNull();
	const projectId = project?.metadata.id ?? "default";

	const messages = useAIStore((s) => s.studioMessages[projectId] || EMPTY_MESSAGES);
	const addMessage = useCallback((message: StudioMessage) => {
		useAIStore.getState().addStudioMessage(projectId, message);
	}, [projectId]);
	const updateMessage = useCallback((id: string, content: string) => {
		useAIStore.getState().updateStudioMessage(projectId, id, content);
	}, [projectId]);
	const clearMessages = useCallback(() => {
		useAIStore.getState().clearStudioMessages(projectId);
	}, [projectId]);

	const transcriptSegments = useTranscriptStore((s) => s.segments);
	const hasTranscript = transcriptSegments.length > 0;

	const [mode, setMode] = useState<StudioMode>("chat");
	const [inputValue, setInputValue] = useState("");
	const [isThinking, setIsThinking] = useState(false);
	const [agentStatus, setAgentStatus] = useState("");
	const thinkingMessage = useThinkingMessage(isThinking);
	const [selectedWorkflow, setSelectedWorkflow] = useState<string | null>(
		null,
	);
	const [completedSteps, setCompletedSteps] = useState<Set<string>>(
		new Set(),
	);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	const thinkingScrollRef = useRef<HTMLDivElement>(null);

	// ── Model name display ──
	const [activeModel, setActiveModel] = useState("");
	const [isRecording, setIsRecording] = useState(false);
	const recognitionRef = useRef<any>(null);
	const mediaRecorderRef = useRef<MediaRecorder | null>(null);
	const audioChunksRef = useRef<Blob[]>([]);

	// Auto-resize textarea
	useEffect(() => {
		const textarea = inputRef.current;
		if (!textarea) return;
		textarea.style.height = "auto";
		textarea.style.height = `${Math.min(textarea.scrollHeight, 100)}px`;
	}, [inputValue]);

	const toggleRecording = useCallback(() => {
		if (isRecording) {
			if (recognitionRef.current) {
				recognitionRef.current.stop();
			}
			if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
				mediaRecorderRef.current.stop();
			}
			setIsRecording(false);
			return;
		}

		const SpeechLib = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
		if (SpeechLib) {
			const rec = new SpeechLib();
			rec.continuous = false;
			rec.interimResults = false;
			rec.lang = "en-US";
			
			rec.onstart = () => {
				setIsRecording(true);
			};
			
			rec.onresult = (event: any) => {
				const text = event.results[0][0].transcript;
				if (text) {
					setInputValue((prev) => (prev ? `${prev} ${text}` : text));
				}
			};
			
			rec.onerror = (e: any) => {
				console.error("Speech recognition error", e);
				setIsRecording(false);
			};
			
			rec.onend = () => {
				setIsRecording(false);
			};
			
			recognitionRef.current = rec;
			rec.start();
		} else {
			// Fallback: record audio blob & transcribe via backend
			navigator.mediaDevices.getUserMedia({ audio: true })
				.then((stream) => {
					const mediaRecorder = new MediaRecorder(stream);
					mediaRecorderRef.current = mediaRecorder;
					audioChunksRef.current = [];
					
					mediaRecorder.ondataavailable = (event) => {
						if (event.data.size > 0) {
							audioChunksRef.current.push(event.data);
						}
					};
					
					mediaRecorder.onstop = async () => {
						const audioBlob = new Blob(audioChunksRef.current, { type: "audio/wav" });
						const audioFile = new File([audioBlob], "speech.wav", { type: "audio/wav" });
						setIsThinking(true);
						try {
							const res = await aiClient.transcribe(audioFile);
							if (res && res.segments) {
								const fullText = res.segments.map((s) => s.text).join(" ").trim();
								if (fullText) {
									setInputValue((prev) => (prev ? `${prev} ${fullText}` : fullText));
								}
							}
						} catch (err) {
							console.error("Transcription error", err);
							toast.error("Failed to transcribe voice input");
						} finally {
							setIsThinking(false);
						}
						stream.getTracks().forEach((track) => track.stop());
					};
					
					mediaRecorder.start();
					setIsRecording(true);
				})
				.catch((err) => {
					console.error("Mic access error", err);
					toast.error("Could not access microphone");
				});
		}
	}, [isRecording, setIsThinking, setInputValue]);

	useEffect(() => {
		aiClient.llmStatus().then((data) => {
			if (data.available) {
				setActiveModel(data.default_model || "");
			}
		}).catch(() => {});
	}, []);

	// Auto-scroll on new messages
	useEffect(() => {
		if (scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
		}
		if (isThinking && thinkingScrollRef.current) {
			thinkingScrollRef.current.scrollTop = thinkingScrollRef.current.scrollHeight;
		}
	}, [messages, isThinking]);

	const handleSend = useCallback(async (overridePrompt?: string) => {
		const promptValue = overridePrompt ?? inputValue;
		const trimmed = promptValue.trim();
		if (!trimmed || isThinking) return;

		if (!isConnected) {
			toast.error("AI backend is not connected", {
				description: "Start the AI backend to use AI Studio.",
			});
			return;
		}

		addMessage({
			id: crypto.randomUUID(),
			role: "user",
			content: trimmed,
		});
		if (!overridePrompt) {
			setInputValue("");
		}
		setIsThinking(true);

		const assistantId = crypto.randomUUID();
		let messageAdded = false;

		try {
			let prompt = trimmed;
			let systemPrompt: string | undefined;

			if (mode === "transcript" && hasTranscript) {
				const fullText = transcriptSegments.map((s) => s.text).join(" ");
				systemPrompt =
					"You are a video script editor. The user has a video transcript and wants you to help edit, rewrite, or improve it. " +
					"When rewriting, preserve the key information but improve the text as requested. " +
					"Return only the improved text, not explanations.";
				if (!prompt.includes(fullText.slice(0, 50))) {
					prompt = `${prompt}\n\nTranscript:\n${fullText}`;
				}

				let accumulatedResult = "";
				const result = await aiClient.chatStream(
					prompt,
					(_token, accumulated) => {
						accumulatedResult = accumulated;
						if (!messageAdded) {
							addMessage({
								id: assistantId,
								role: "assistant",
								content: accumulated,
							});
							messageAdded = true;
						} else {
							updateMessage(assistantId, accumulated);
						}
					},
					systemPrompt,
				);

				const responseText = result.response || accumulatedResult;
				if (!responseText) {
					const fallbackMsg = "Here's what I suggest based on your request.";
					if (!messageAdded) {
						addMessage({ id: assistantId, role: "assistant", content: fallbackMsg });
					} else {
						updateMessage(assistantId, fallbackMsg);
					}
				}
			} else if (mode === "chat") {
				systemPrompt = COPILOT_SYSTEM_PROMPT;

				let lastTurn = 1;
				let accumulatedContent = "";
				setAgentStatus("Starting agent loop...");
				const loopResult = await runAgentLoop({
					goal: prompt,
					systemPrompt,
					editor,
					history: messages.map(m => ({ role: m.role, content: m.content })),
					onToken: (token, turn) => {
						lastTurn = turn;
						accumulatedContent += token;
						setAgentStatus(`Generating reasoning (turn ${turn}/8)...`);
						if (!messageAdded) {
							addMessage({
								id: assistantId,
								role: "assistant",
								content: accumulatedContent,
							});
							messageAdded = true;
						} else {
							updateMessage(assistantId, accumulatedContent);
						}
					},
					onToolCall: (toolName, params, turn) => {
						lastTurn = turn;
						const toolMessage = `\n\n> 🛠️ **Tool Call (Turn ${turn}/8):** Running \`${toolName}\`... \n\n`;
						accumulatedContent += toolMessage;
						setAgentStatus(`Running tool ${toolName} (turn ${turn}/8)...`);
						if (!messageAdded) {
							addMessage({
								id: assistantId,
								role: "assistant",
								content: accumulatedContent,
							});
							messageAdded = true;
						} else {
							updateMessage(assistantId, accumulatedContent);
						}
					},
					maxIterations: 8,
				});

				const finalContent = loopResult.rawOutput || "No plan was generated.";
				if (!messageAdded) {
					addMessage({
						id: assistantId,
						role: "assistant",
						content: finalContent,
					});
				} else {
					updateMessage(assistantId, finalContent);
				}
			}

		} catch (error) {
			const detail = error instanceof Error ? error.message : "";
			const isOllamaDown = detail.includes("503") || detail.includes("Ollama");
			const errorContent = isOllamaDown
				? "Ollama is not running or no LLM model is loaded. Open the AI Setup guide (click the AI indicator in the header) to pull a model like `llama3.1:8b`."
				: `Something went wrong: ${detail || "Unknown error"}. Make sure the AI backend and Ollama are running with a model loaded.`;

			if (!messageAdded) {
				addMessage({ id: assistantId, role: "assistant", content: errorContent });
			} else {
				updateMessage(assistantId, errorContent);
			}
		} finally {
			setIsThinking(false);
			setAgentStatus("");
		}
	}, [inputValue, isThinking, isConnected, mode, hasTranscript, transcriptSegments, addMessage, updateMessage, editor, messages]);

	const handleRetry = useCallback(async () => {
		const userMsgs = messages.filter((m) => m.role === "user");
		if (userMsgs.length === 0) return;
		const lastUserMsg = userMsgs[userMsgs.length - 1];

		const userIndex = messages.findIndex((m) => m.id === lastUserMsg.id);
		if (userIndex === -1) return;

		const kept = messages.slice(0, userIndex + 1);
		useAIStore.setState((state) => ({
			studioMessages: {
				...state.studioMessages,
				[projectId]: kept,
			},
		}));

		handleSend(lastUserMsg.content);
	}, [messages, handleSend, projectId]);


	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLTextAreaElement>) => {
			if (event.key === "Enter" && !event.shiftKey) {
				event.preventDefault();
				handleSend();
			}
		},
		[handleSend],
	);

	const handleStarterPrompt = (prompt: string) => {
		setInputValue(prompt);
		requestAnimationFrame(() => {
			inputRef.current?.focus();
			if (inputRef.current) {
				inputRef.current.selectionStart = prompt.length;
				inputRef.current.selectionEnd = prompt.length;
			}
		});
	};

	const handleStepClick = (stepId: string) => {
		setCompletedSteps((prev) => {
			const next = new Set(prev);
			if (next.has(stepId)) {
				next.delete(stepId);
			} else {
				next.add(stepId);
			}
			return next;
		});
	};

	const activeWorkflow = VIDEO_WORKFLOWS.find(
		(w) => w.id === selectedWorkflow,
	);

	return (
		<div className="relative flex h-full flex-col overflow-hidden">
			{/* Header */}
			<div className="bg-background h-11 shrink-0 px-4 pr-2 flex items-center justify-between border-b">
				<div className="flex items-center gap-2">
					{activeModel && (
						<Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-mono">
							{activeModel}
						</Badge>
					)}
					{!isConnected && (
						<Badge variant="outline" className="text-[8px] px-1.5 py-0 text-yellow-500 border-yellow-500/30">
							Offline
						</Badge>
					)}
				</div>
				<div className="flex items-center gap-1">
					{(mode === "chat" || mode === "transcript") && messages.length > 0 && (
						<Button
							variant="ghost"
							size="sm"
							className="h-6 text-[10px] px-1.5 text-muted-foreground"
							onClick={clearMessages}
						>
							<HugeiconsIcon icon={Delete02Icon} className="size-3" />
						</Button>
					)}
					{hasTranscript && (
						<Button
							variant={mode === "transcript" ? "secondary" : "ghost"}
							size="sm"
							className="h-6 text-[10px] px-2"
							onClick={() => setMode("transcript")}
						>
							Script
						</Button>
					)}
					<Button
						variant={mode === "chat" ? "secondary" : "ghost"}
						size="sm"
						className="h-6 text-[10px] px-2"
						onClick={() => setMode("chat")}
					>
						Chat
					</Button>
					<Button
						variant={mode === "templates" ? "secondary" : "ghost"}
						size="sm"
						className="h-6 text-[10px] px-2"
						onClick={() => setMode("templates")}
					>
						Templates
					</Button>
					<Button
						variant={mode === "ideas" ? "secondary" : "ghost"}
						size="sm"
						className="h-6 text-[10px] px-2 gap-1"
						onClick={() => setMode("ideas")}
					>
						Ideas
						{savedIdeas.length > 0 && (
							<span className="bg-primary text-primary-foreground rounded-full text-[8px] size-4 flex items-center justify-center font-bold">
								{savedIdeas.length}
							</span>
						)}
					</Button>
					{hasTranscript && (
						<Button
							variant={mode === "broll" ? "secondary" : "ghost"}
							size="sm"
							className="h-6 text-[10px] px-2"
							onClick={() => setMode("broll")}
						>
							B-Roll
						</Button>
					)}
					{hasTranscript && (
						<Button
							variant={mode === "dubbing" ? "secondary" : "ghost"}
							size="sm"
							className="h-6 text-[10px] px-2"
							onClick={() => setMode("dubbing")}
						>
							Dub
						</Button>
					)}
					{hasTranscript && (
						<Button
							variant={mode === "chapters" ? "secondary" : "ghost"}
							size="sm"
							className="h-6 text-[10px] px-2"
							onClick={() => setMode("chapters")}
						>
							Chapters
						</Button>
					)}
					<Button
						variant={mode === "workflow" ? "secondary" : "ghost"}
						size="sm"
						className="h-6 text-[10px] px-2"
						onClick={() => setMode("workflow")}
					>
						Workflows
					</Button>
					<Button
						variant={mode === "youtube-reels" ? "secondary" : "ghost"}
						size="sm"
						className="h-6 text-[10px] px-2"
						onClick={() => setMode("youtube-reels")}
					>
						YT Reels
					</Button>
					<Button
						variant={mode === "reframe" ? "secondary" : "ghost"}
						size="sm"
						className="h-6 text-[10px] px-2"
						onClick={() => setMode("reframe")}
					>
						Reframe
					</Button>
					<Button
						variant={mode === "tracking" ? "secondary" : "ghost"}
						size="sm"
						className="h-6 text-[10px] px-2"
						onClick={() => setMode("tracking")}
					>
						Tracking
					</Button>
					<Button
						variant={mode === "ab-testing" ? "secondary" : "ghost"}
						size="sm"
						className="h-6 text-[10px] px-2"
						onClick={() => setMode("ab-testing")}
					>
						A/B Test
					</Button>
				</div>
			</div>

			{/* Not connected banner */}
			{!isConnected && (
				<div className="mx-2 mt-2 rounded-lg bg-yellow-500/10 px-3 py-2 text-[11px] text-yellow-500 shrink-0">
					<p className="font-medium">AI backend not connected</p>
					<p className="text-yellow-500/70 mt-0.5">
						Start the backend to use AI brainstorming.
					</p>
					<Button
						variant="outline"
						size="sm"
						className="h-6 text-[10px] mt-1.5"
						onClick={toggleSetupGuide}
					>
						Setup guide
					</Button>
				</div>
			)}

			{/* ── Chat / Transcript Mode ── */}
			{(mode === "chat" || mode === "transcript") && (
				<>
					{/* Scrollable messages — fills available space */}
					<div
						ref={scrollRef}
						className="flex-1 min-h-0 overflow-y-auto px-2 py-2"
					>
						{messages.length === 0 && mode === "transcript" && hasTranscript && (
							<div className="flex flex-col gap-3 py-4 px-1">
								<div className="text-center">
									<HugeiconsIcon
										icon={TextIcon}
										className="size-8 text-muted-foreground/30 mx-auto mb-2"
									/>
									<p className="text-xs font-medium">
										Edit script with AI
									</p>
									<p className="text-[10px] text-muted-foreground mt-0.5">
										Rewrite, improve, or transform your transcript
									</p>
								</div>

								<div className="rounded-md bg-muted/50 px-3 py-2 max-h-32 overflow-y-auto">
									<p className="text-[10px] text-muted-foreground leading-relaxed">
										{transcriptSegments.map((s) => s.text).join(" ").slice(0, 300)}
										{transcriptSegments.map((s) => s.text).join(" ").length > 300 && "..."}
									</p>
								</div>

								<div className="flex flex-col gap-1.5">
									{TRANSCRIPT_PROMPTS.map((starter) => (
										<button
											key={starter.label}
											type="button"
											onClick={() => {
												const fullText = transcriptSegments.map((s) => s.text).join(" ");
												handleStarterPrompt(starter.prompt + fullText);
											}}
											className="text-left rounded-md border px-2.5 py-2 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
										>
											{starter.label}
										</button>
									))}
								</div>
							</div>
						)}

						{messages.length === 0 && mode === "chat" && (
							<div className="flex flex-col gap-3 py-4 px-1">
								<div className="text-center">
									<HugeiconsIcon
										icon={SparklesIcon}
										className="size-8 text-muted-foreground/30 mx-auto mb-2"
									/>
									<p className="text-xs font-medium">
										Brainstorm with AI
									</p>
									<p className="text-[10px] text-muted-foreground mt-0.5">
										Plan your video, write scripts, generate
										ideas
									</p>
								</div>

								<div className="flex flex-col gap-1.5">
									{STARTER_PROMPTS.map((starter) => (
										<button
											key={starter.label}
											type="button"
											onClick={() =>
												handleStarterPrompt(
													starter.prompt,
												)
											}
											className="text-left rounded-md border px-2.5 py-2 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
										>
											{starter.label}
										</button>
									))}
								</div>
							</div>
						)}

						{messages.map((msg, index) => (
							<ChatMessage
								key={msg.id}
								message={msg as any}
								isThinking={isThinking && index === messages.length - 1}
								thinkingScrollRef={thinkingScrollRef}
								onRetry={handleRetry}
								saveIdea={saveIdea}
							/>
						))}

						{isThinking && (
							<div className="mx-2 my-1">
								<div className="border border-dashed border-primary/30 rounded-lg px-3 py-2.5 bg-primary/[0.03]">
									<div className="flex items-center gap-2">
										<Spinner className="size-3 text-primary/60" />
										<span className="text-[11px] text-primary/70 font-medium animate-pulse">
											{agentStatus || thinkingMessage}
										</span>
									</div>
								</div>
							</div>
						)}
					</div>

					{/* Input — ALWAYS at bottom, outside scroll */}
					<div className="border-t px-2 py-2 shrink-0 bg-background space-y-1.5">
						{/* Quick suggestions */}
						<div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none scroll-smooth">
							{QUICK_ACTIONS.map((action) => (
								<button
									key={action.label}
									type="button"
									onClick={() => {
										setInputValue(action.prompt);
										inputRef.current?.focus();
									}}
									className="shrink-0 rounded-full border bg-muted/40 px-2.5 py-1 text-[10px] text-muted-foreground hover:bg-primary/5 hover:text-primary hover:border-primary/20 transition-all font-medium"
								>
									{action.label}
								</button>
							))}
						</div>

						<div className="flex items-end gap-1.5">
							<textarea
								ref={inputRef}
								value={inputValue}
								onChange={(event) =>
									setInputValue(event.target.value)
								}
								onKeyDown={handleKeyDown}
								placeholder={
									!isConnected
										? "Connect AI backend first"
										: mode === "transcript"
											? "Tell AI how to edit the transcript..."
											: "Describe your video idea..."
								}
								disabled={!isConnected}
								rows={1}
								className={cn(
									"flex-1 resize-none rounded-md border bg-transparent px-2.5 py-2 text-xs outline-none",
									"focus:ring-1 focus:ring-ring",
									"placeholder:text-muted-foreground/50",
									"disabled:opacity-50",
									"min-h-[36px] max-h-[100px]",
								)}
								style={
									{
										fieldSizing: "content",
									} as React.CSSProperties
								}
							/>
							<Button
								size="icon"
								type="button"
								variant={isRecording ? "destructive" : "secondary"}
								className={cn(
									"size-[36px] shrink-0 transition-all duration-300",
									isRecording && "animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.5)] border-red-500 bg-red-500 hover:bg-red-600"
								)}
								onClick={toggleRecording}
								disabled={isThinking || !isConnected}
								title={isRecording ? "Stop recording voice" : "Voice input"}
							>
								<HugeiconsIcon
									icon={AiMicIcon}
									className={cn("size-3.5", isRecording ? "text-white" : "text-muted-foreground")}
								/>
							</Button>
							<Button
								size="icon"
								variant={
									inputValue.trim() ? "default" : "secondary"
								}
								className="size-[36px] shrink-0"
								onClick={() => handleSend()}
								disabled={
									!inputValue.trim() ||
									isThinking ||
									!isConnected
								}
							>
								{isThinking ? (
									<Spinner className="size-3.5" />
								) : (
									<HugeiconsIcon
										icon={SentIcon}
										className="size-3.5"
									/>
								)}
							</Button>
						</div>
						<p className="text-[9px] text-muted-foreground mt-1 text-center">
							Enter to send &middot; Shift+Enter for new line
						</p>
					</div>
				</>
			)}

			{/* ── Templates Mode ── */}
			{mode === "templates" && (
				<TemplatePanel className="flex-1 min-h-0" />
			)}

			{/* ── B-Roll Mode ── */}
			{mode === "broll" && (
				<BRollSuggestionsPanel className="flex-1 min-h-0" />
			)}

			{/* ── Dubbing Mode ── */}
			{mode === "dubbing" && (
				<div className="flex-1 min-h-0 overflow-y-auto">
					<AIDubbingPanel />
				</div>
			)}

			{/* ── Auto Chapters Mode ── */}
			{mode === "chapters" && (
				<div className="flex-1 min-h-0 overflow-y-auto">
					<AutoChaptersPanel />
				</div>
			)}

			{/* ── YouTube Reels Mode ── */}
			{mode === "youtube-reels" && (
				<div className="flex-1 min-h-0 overflow-y-auto px-2 py-3">
					<YouTubeReelsPanel />
				</div>
			)}

			{/* ── Smart Reframe Mode ── */}
			{mode === "reframe" && (
				<SmartReframePanel className="flex-1 min-h-0" />
			)}

			{/* ── Motion Tracking Mode ── */}
			{mode === "tracking" && (
				<MotionTrackingPanel className="flex-1 min-h-0" />
			)}

			{/* ── A/B Testing Mode ── */}
			{mode === "ab-testing" && (
				<ABTestingPanel className="flex-1 min-h-0" />
			)}


			{/* ── Ideas Mode ── */}
			{mode === "ideas" && (
				<div className="flex-1 min-h-0 overflow-y-auto px-2 py-3">
					{savedIdeas.length === 0 ? (
						<div className="flex flex-col items-center justify-center h-full gap-2 text-center px-4">
							<HugeiconsIcon
								icon={Bookmark01Icon}
								className="size-8 text-muted-foreground/30"
							/>
							<p className="text-xs font-medium">No saved ideas yet</p>
							<p className="text-[10px] text-muted-foreground leading-relaxed">
								Chat with AI and hit &ldquo;Save idea&rdquo; on any response to collect it here.
							</p>
							<Button
								variant="outline"
								size="sm"
								className="h-7 text-[11px] mt-2"
								onClick={() => setMode("chat")}
							>
								<HugeiconsIcon icon={SparklesIcon} className="size-3 mr-1" />
								Start brainstorming
							</Button>
						</div>
					) : (
						<>
							<div className="flex items-center justify-between px-1 mb-2">
								<p className="text-[11px] text-muted-foreground">
									{savedIdeas.length} saved idea{savedIdeas.length !== 1 ? "s" : ""}
								</p>
								<Button
									variant="ghost"
									size="sm"
									className="h-6 text-[10px] px-1.5 text-muted-foreground"
									onClick={clearIdeas}
								>
									<HugeiconsIcon icon={Delete02Icon} className="size-3 mr-0.5" />
									Clear all
								</Button>
							</div>
							<div className="flex flex-col gap-2">
								{savedIdeas.map((idea) => (
									<div
										key={idea.id}
										className="rounded-lg border px-3 py-2.5 group relative"
									>
										<div className="text-xs leading-relaxed line-clamp-6 pr-6">
											<ReactMarkdown
												components={{
													p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
													strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
													ul: ({ children }) => <ul className="list-disc pl-4 mb-1 space-y-0.5">{children}</ul>,
													ol: ({ children }) => <ol className="list-decimal pl-4 mb-1 space-y-0.5">{children}</ol>,
													li: ({ children }) => <li>{children}</li>,
												}}
											>
												{idea.content.length > 500
													? `${idea.content.slice(0, 500)}...`
													: idea.content}
											</ReactMarkdown>
										</div>
										<div className="flex items-center justify-between mt-2 pt-1.5 border-t border-border/50">
											<span className="text-[9px] text-muted-foreground">
												{new Date(idea.savedAt).toLocaleDateString(undefined, {
													month: "short",
													day: "numeric",
													hour: "2-digit",
													minute: "2-digit",
												})}
											</span>
											<Button
												variant="ghost"
												size="sm"
												className="h-5 px-1.5 text-[10px] text-muted-foreground hover:text-destructive"
												onClick={() => removeIdea(idea.id)}
											>
												<HugeiconsIcon icon={Delete02Icon} className="size-3" />
											</Button>
										</div>
									</div>
								))}
							</div>
						</>
					)}
				</div>
			)}

			{/* ── Workflow Mode ── */}
			{mode === "workflow" && !activeWorkflow && (
				<div className="flex-1 min-h-0 overflow-y-auto px-2 py-3">
					<p className="text-[11px] text-muted-foreground px-1 mb-2">
						Follow a step-by-step guide to create your video from
						idea to export.
					</p>
					{VIDEO_WORKFLOWS.map((workflow) => (
						<button
							key={workflow.id}
							type="button"
							onClick={() => setSelectedWorkflow(workflow.id)}
							className="flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left hover:bg-accent transition-colors w-full mb-2"
						>
							<HugeiconsIcon
								icon={SparklesIcon}
								className="size-4 text-primary mt-0.5 shrink-0"
							/>
							<div className="flex-1 min-w-0">
								<p className="text-xs font-medium">
									{workflow.title}
								</p>
								<p className="text-[10px] text-muted-foreground mt-0.5">
									{workflow.description}
								</p>
								<Badge
									variant="secondary"
									className="text-[9px] mt-1.5"
								>
									{workflow.steps.length} steps
								</Badge>
							</div>
							<HugeiconsIcon
								icon={ArrowRight01Icon}
								className="size-3.5 text-muted-foreground mt-1 shrink-0"
							/>
						</button>
					))}
				</div>
			)}

			{/* ── Active Workflow ── */}
			{mode === "workflow" && activeWorkflow && (
				<div className="flex-1 min-h-0 overflow-y-auto px-2 py-3">
					<div className="flex items-center gap-2 px-1 mb-1">
						<button
							type="button"
							onClick={() => setSelectedWorkflow(null)}
							className="text-[10px] text-muted-foreground hover:text-foreground"
						>
							Workflows
						</button>
						<span className="text-[10px] text-muted-foreground">
							/
						</span>
						<span className="text-[11px] font-medium">
							{activeWorkflow.title}
						</span>
					</div>

					{/* Progress */}
					<div className="flex items-center gap-2 px-1 mb-2">
						<div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
							<div
								className="h-full bg-primary rounded-full transition-all"
								style={{
									width: `${(completedSteps.size / activeWorkflow.steps.length) * 100}%`,
								}}
							/>
						</div>
						<span className="text-[10px] text-muted-foreground tabular-nums">
							{completedSteps.size}/{activeWorkflow.steps.length}
						</span>
					</div>

					{/* Steps */}
					<div className="flex flex-col gap-2">
						{activeWorkflow.steps.map((step, index) => {
							const isCompleted = completedSteps.has(step.id);
							const isActive =
								!isCompleted &&
								(index === 0 ||
									completedSteps.has(
										activeWorkflow.steps[index - 1].id,
									));

							return (
								<button
									key={step.id}
									type="button"
									onClick={() => handleStepClick(step.id)}
									className={cn(
										"flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-all",
										isCompleted &&
											"border-green-500/30 bg-green-500/5",
										isActive &&
											"border-primary/30 bg-primary/5",
										!isCompleted &&
											!isActive &&
											"opacity-60",
									)}
								>
									<div
										className={cn(
											"flex items-center justify-center size-5 rounded-full text-[9px] font-bold shrink-0 mt-0.5",
											isCompleted
												? "bg-green-500 text-white"
												: isActive
													? "bg-primary text-primary-foreground"
													: "bg-muted text-muted-foreground",
										)}
									>
										{isCompleted ? "\u2713" : index + 1}
									</div>

									<div className="flex-1 min-w-0">
										<p
											className={cn(
												"text-[11px] font-medium",
												isCompleted &&
													"line-through text-muted-foreground",
											)}
										>
											{step.label}
										</p>
										<p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">
											{step.description}
										</p>
									</div>
								</button>
							);
						})}

						{/* Ask AI about this step */}
						{isConnected && (
							<Button
								variant="outline"
								size="sm"
								className="h-7 text-[11px] mt-1"
								onClick={() => {
									setMode("chat");
									const currentStep =
										activeWorkflow.steps.find(
											(step) =>
												!completedSteps.has(step.id),
										);
									if (currentStep) {
										setInputValue(
											`Help me with "${currentStep.label}" for my ${activeWorkflow.title}. ${currentStep.description}`,
										);
										requestAnimationFrame(() =>
											inputRef.current?.focus(),
										);
									}
								}}
							>
								<HugeiconsIcon
									icon={SparklesIcon}
									className="size-3 mr-1"
								/>
								Ask AI about next step
							</Button>
						)}
					</div>
				</div>
			)}
		</div>
	);
}
