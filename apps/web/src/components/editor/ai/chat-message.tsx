"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { PlanExecutionBlock } from "./plan-execution-block";
import type { CopilotPlan } from "@/lib/copilot/copilot-types";

// Helper to strip JSON objects from text display
function stripJSON(text: string): string {
	let cleaned = text;

	// 1. Handle unclosed markdown code blocks at the end of the text
	const lastTripleBacktick = cleaned.lastIndexOf("```");
	if (lastTripleBacktick !== -1) {
		const after = cleaned.slice(lastTripleBacktick + 3);
		if (!after.includes("```")) {
			if (after.match(/^(?:json|\s*\{|\s*\[)/i) || after.includes('"') || after.includes(':')) {
				cleaned = cleaned.slice(0, lastTripleBacktick);
			} else {
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

	// 3. Scan for JSON objects/arrays
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
				const remaining = cleaned.slice(i);
				if (remaining.includes('"') || remaining.includes(':') || remaining.includes(',') || remaining.length > 5) {
					break;
				}
			}
		}
		result += cleaned[i];
		i++;
	}

	return result.trim();
}

interface ChatMessageProps {
	message: {
		id: string;
		role: "user" | "assistant" | "system";
		content: string;
		timestamp?: number;
		error?: boolean;
	};
	isThinking?: boolean;
	thinkingScrollRef?: React.RefObject<HTMLDivElement | null>;
	onRetry?: () => void;
	saveIdea?: (idea: string) => void;
}

export function ChatMessage({
	message,
	isThinking = false,
	thinkingScrollRef,
	onRetry,
	saveIdea,
}: ChatMessageProps) {
	const { role, content, timestamp = Date.now(), error } = message;
	const [showToolLogs, setShowToolLogs] = useState(false);

	const formattedTime = new Date(timestamp).toLocaleTimeString([], {
		hour: "2-digit",
		minute: "2-digit",
	});

	const handleCopy = () => {
		navigator.clipboard.writeText(content);
		toast.success("Copied to clipboard");
	};

	if (role === "user") {
		return (
			<div className="flex flex-col items-end mb-4 animate-in fade-in slide-in-from-right-3 duration-200">
				<div className="max-w-[85%] rounded-2xl bg-primary text-primary-foreground px-4 py-2.5 text-xs shadow-sm">
					{content}
				</div>
				<span className="text-[9px] text-muted-foreground mt-1 mr-1">{formattedTime}</span>
			</div>
		);
	}

	// Assistant / System Message parsing
	const planMatch = content.match(/```(?:json\s+copilot-plan|json)\s*([\s\S]*?)\s*```/);
	let plan: CopilotPlan | null = null;
	let textContent = content;

	if (planMatch && planMatch[1].includes('"steps"')) {
		try {
			plan = JSON.parse(planMatch[1]);
			textContent = textContent.replace(planMatch[0], "");
		} catch {}
	}

	textContent = stripJSON(textContent);

	// Extract tool calls to show in collapsible logger
	const toolCallMatches = Array.from(content.matchAll(/```json tool-call\s*([\s\S]*?)\s*```/g));
	const toolResults = Array.from(content.matchAll(/System: Tool Result:\s*([\s\S]*?)(?=\n\n|$)/g));

	return (
		<div className="flex gap-2.5 mb-4 animate-in fade-in slide-in-from-left-3 duration-200">
			{/* AI Avatar */}
			<div className="size-6 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0 mt-0.5 shadow-sm border border-primary/20">
				<svg className="size-3.5" viewBox="0 0 24 24" fill="currentColor">
					<path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7zm2.85 11.1c-.37.26-.59.68-.59 1.14V16h-4.52v-.76c0-.46-.22-.88-.59-1.14C8.61 13.02 8 11.58 8 10c0-2.21 1.79-4 4-4s4 1.79 4 4c0 1.58-.61 3.02-1.15 4.1z" />
				</svg>
			</div>

			<div className="flex-1 min-w-0">
				<div className={`rounded-2xl bg-muted/65 px-4 py-3.5 border border-border/40 shadow-sm ${error ? "border-red-500/20 bg-red-500/5" : ""}`}>
					<div className="prose-studio text-xs leading-relaxed text-foreground/90">
						{textContent ? (
							<div ref={isThinking ? (thinkingScrollRef as any) : undefined} className={isThinking ? "max-h-24 overflow-y-auto pr-1 pb-1 mb-2 scrollbar-thin border-b border-border/10" : "pr-1 pb-1"}>
								<ReactMarkdown
									components={{
										h1: ({ children }) => <h3 className="text-sm font-bold mt-2.5 mb-1.5 text-foreground">{children}</h3>,
										h2: ({ children }) => <h4 className="text-xs font-bold mt-2 mb-1 text-foreground">{children}</h4>,
										h3: ({ children }) => <h4 className="text-xs font-semibold mt-1.5 mb-0.5 text-foreground">{children}</h4>,
										p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
										strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
										em: ({ children }) => <em className="italic">{children}</em>,
										ul: ({ children }) => <ul className="list-disc pl-4.5 mb-2 space-y-1">{children}</ul>,
										ol: ({ children }) => <ol className="list-decimal pl-4.5 mb-2 space-y-1">{children}</ol>,
										li: ({ children }) => <li>{children}</li>,
										code: ({ children }) => (
											<code className="bg-background border border-border/50 rounded px-1.5 py-0.5 text-[10px] font-mono">{children}</code>
										),
										blockquote: ({ children }) => (
											<blockquote className="border-l-3 border-primary pl-2.5 my-2 text-muted-foreground italic bg-primary/5 py-1 pr-2 rounded-r-md">
												{children}
											</blockquote>
										),
									}}
								>
									{textContent}
								</ReactMarkdown>
							</div>
						) : (
							isThinking && <span className="text-muted-foreground italic">Thinking...</span>
						)}

						{/* Collapsible Tool Execution Logs */}
						{toolCallMatches.length > 0 && (
							<div className="mt-3 border border-border/50 rounded-lg overflow-hidden bg-background/50">
								<button
									type="button"
									className="w-full flex items-center justify-between px-3 py-2 text-[10px] font-medium text-muted-foreground hover:bg-accent/40 border-b border-border/30 transition-colors"
									onClick={() => setShowToolLogs(!showToolLogs)}
								>
									<span className="flex items-center gap-1.5">
										<span className="relative flex h-1.5 w-1.5">
											<span className="absolute inline-flex h-full w-full rounded-full bg-primary/50 animate-ping"></span>
											<span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary"></span>
										</span>
										Tool Executions ({toolCallMatches.length})
									</span>
									<span className="text-[8px]">{showToolLogs ? "HIDE LOGS" : "SHOW LOGS"}</span>
								</button>
								{showToolLogs && (
									<div className="p-2.5 space-y-2 font-mono text-[9px] max-h-48 overflow-y-auto bg-background/80 scrollbar-thin">
										{toolCallMatches.map((match, idx) => {
											let callDetails = match[1];
											try {
												callDetails = JSON.stringify(JSON.parse(match[1]), null, 2);
											} catch {}
											const resultText = toolResults[idx]?.[1] || "Waiting for execution...";
											return (
												<div key={idx} className="border-b border-border/20 last:border-b-0 pb-2 last:pb-0">
													<div className="text-primary font-medium mb-1">&gt; Call Tool: {callDetails}</div>
													<div className="text-muted-foreground whitespace-pre-wrap bg-muted/30 p-1.5 rounded">{resultText}</div>
												</div>
											);
										})}
									</div>
								)}
							</div>
						)}

						{plan && <PlanExecutionBlock plan={plan} />}
					</div>

					{/* Message Actions */}
					{!isThinking && (
						<div className="flex items-center justify-between mt-2 pt-2 border-t border-border/30">
							<div className="flex items-center gap-2">
								<button
									type="button"
									className="text-[10px] text-muted-foreground hover:text-foreground transition-colors px-1"
									onClick={handleCopy}
								>
									Copy
								</button>
								{saveIdea && (
									<button
										type="button"
										className="text-[10px] text-muted-foreground hover:text-foreground transition-colors px-1"
										onClick={() => {
											saveIdea(content);
											toast.success("Saved to Ideas board");
										}}
									>
										Save Idea
									</button>
								)}
								{error && onRetry && (
									<button
										type="button"
										className="text-[10px] text-red-500 hover:text-red-600 transition-colors font-medium px-1"
										onClick={onRetry}
									>
										Retry Response
									</button>
								)}
							</div>
							<span className="text-[9px] text-muted-foreground/60">{formattedTime}</span>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
