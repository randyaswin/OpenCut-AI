"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "sonner";
import { useEditor } from "@/hooks/use-editor";
import { executeAction, previewAction } from "@/lib/ai-action-executor";
import type { CopilotPlan, CopilotStep } from "@/lib/copilot/copilot-types";

interface PlanExecutionBlockProps {
	plan: CopilotPlan;
}

export function PlanExecutionBlock({ plan }: PlanExecutionBlockProps) {
	const editor = useEditor();
	const [steps, setSteps] = useState<CopilotStep[]>(() =>
		plan.steps.map((s) => ({ ...s, status: "pending" as const }))
	);
	const [status, setStatus] = useState<"pending" | "running" | "completed" | "error">("pending");
	const [needsConfirm, setNeedsConfirm] = useState(plan.requiresConfirmation);
	const [currentStepIndex, setCurrentStepIndex] = useState<number | null>(null);

	const handleExecute = async () => {
		setNeedsConfirm(false);
		setStatus("running");
		
		const supportsTransaction = typeof editor.command.beginTransaction === "function";
		if (supportsTransaction) {
			editor.command.beginTransaction();
		}

		try {
			for (let i = 0; i < steps.length; i++) {
				setCurrentStepIndex(i);
				setSteps((prev) =>
					prev.map((step, idx) => (idx === i ? { ...step, status: "running" as const } : step))
				);

				const step = steps[i];
				if (step.action) {
					await executeAction(step.action);
				}

				setSteps((prev) =>
					prev.map((step, idx) => (idx === i ? { ...step, status: "completed" as const } : step))
				);
				await new Promise((r) => setTimeout(r, 200));
			}

			if (supportsTransaction) {
				editor.command.commitTransaction();
			}
			setStatus("completed");
			toast.success("All edits applied successfully");
		} catch (error: any) {
			if (supportsTransaction) {
				// Rollback by committing empty or aborting transaction if possible
				try {
					editor.command.commitTransaction();
					// Immediately undo the batch if it failed halfway
					editor.command.undo();
				} catch {}
			}
			setStatus("error");
			setSteps((prev) =>
				prev.map((step, idx) => (idx === currentStepIndex ? { ...step, status: "error" as const, error: error.message || String(error) } : step))
			);
			toast.error("Plan execution failed", {
				description: error.message || String(error),
			});
		} finally {
			setCurrentStepIndex(null);
		}
	};

	const handleUndo = () => {
		try {
			editor.command.undo();
			setSteps((prev) => prev.map((s) => ({ ...s, status: "pending" as const })));
			setStatus("pending");
			setNeedsConfirm(plan.requiresConfirmation);
			toast.success("Undid all applied actions");
		} catch (err: any) {
			toast.error("Failed to undo actions", { description: err.message || err });
		}
	};

	return (
		<div className="my-3 rounded-lg border bg-card p-3.5 shadow-sm border-border/60 transition-all duration-300">
			<div className="flex items-center justify-between mb-3">
				<div className="flex items-center gap-1.5">
					<span className="relative flex h-2 w-2">
						{status === "running" && (
							<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
						)}
						<span className={`relative inline-flex rounded-full h-2 w-2 ${
							status === "completed" ? "bg-green-500" : status === "error" ? "bg-red-500" : "bg-primary"
						}`}></span>
					</span>
					<span className="text-xs font-semibold text-foreground">Editing Plan</span>
				</div>
				<span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
					{plan.estimatedTime || "Quick edit"}
				</span>
			</div>

			<div className="space-y-2 mb-4">
				{steps.map((step, i) => (
					<div
						key={step.id}
						className={`flex items-start gap-2.5 text-xs p-2.5 rounded-lg border transition-colors ${
							step.status === "completed"
								? "bg-green-500/5 border-green-500/10 text-foreground"
								: step.status === "running"
									? "bg-primary/5 border-primary/20 text-foreground animate-pulse"
									: step.status === "error"
										? "bg-red-500/5 border-red-500/20 text-foreground"
										: "bg-muted/30 border-transparent text-muted-foreground"
						}`}
					>
						<div className="shrink-0 mt-0.5">
							{step.status === "running" ? (
								<Spinner className="size-3.5 text-primary" />
							) : step.status === "completed" ? (
								<svg className="size-3.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
									<path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
								</svg>
							) : step.status === "error" ? (
								<svg className="size-3.5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
									<path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
								</svg>
							) : (
								<span className="text-[10px] font-mono opacity-60">0{i + 1}</span>
							)}
						</div>
						<div className="flex-1 min-w-0">
							<p className="font-medium text-foreground leading-tight">{step.description}</p>
							{step.action && (
								<p className="text-[10px] text-muted-foreground mt-1 font-mono truncate opacity-80">
									{previewAction(step.action)}
								</p>
							)}
							{step.error && (
								<p className="text-[10px] text-red-500 mt-1 font-mono leading-relaxed">{step.error}</p>
							)}
						</div>
					</div>
				))}
			</div>

			{needsConfirm ? (
				<div className="rounded-lg border border-yellow-500/25 bg-yellow-500/5 p-3 mb-3">
					<p className="text-[11px] text-yellow-600 dark:text-yellow-500 leading-relaxed mb-2.5">
						⚠️ This plan contains destructive actions (e.g. deleting segments, splitting clips) which will overwrite parts of your timeline. Please confirm you want to proceed.
					</p>
					<div className="flex gap-2">
						<Button size="sm" className="h-7 text-xs flex-1" onClick={handleExecute}>
							Confirm & Execute
						</Button>
						<Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setNeedsConfirm(false)}>
							Cancel Plan
						</Button>
					</div>
				</div>
			) : (
				<div className="flex gap-2">
					{status === "completed" ? (
						<Button size="sm" variant="outline" className="w-full text-xs h-8 border-destructive/25 text-destructive hover:bg-destructive/5" onClick={handleUndo}>
							Undo All Applied Edits
						</Button>
					) : (
						<Button
							size="sm"
							className="w-full text-xs h-8"
							onClick={handleExecute}
							disabled={status === "running"}
						>
							{status === "running" ? "Applying edits..." : "Execute Editing Plan"}
						</Button>
					)}
				</div>
			)}
		</div>
	);
}
