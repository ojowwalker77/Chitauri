import type { ThreadId } from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";

import type { Thread } from "~/types";
import { cn } from "~/lib/utils";
import { CentralIcon } from "~/lib/central-icons";
import { Button } from "~/components/ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "~/components/ui/collapsible";
import { DisclosureChevron } from "~/components/ui/DisclosureChevron";

function delegationState(thread: Thread): "running" | "needs_review" | "failed" {
  if (
    thread.error ||
    thread.latestTurn?.state === "error" ||
    thread.latestTurn?.state === "interrupted" ||
    thread.session?.orchestrationStatus === "error" ||
    thread.session?.orchestrationStatus === "interrupted"
  ) {
    return "failed";
  }
  if (
    thread.session?.status === "running" ||
    thread.session?.orchestrationStatus === "running" ||
    thread.latestTurn?.state === "running"
  ) {
    return "running";
  }
  return "needs_review";
}

function finalAssistantMessage(thread: Thread): string | null {
  return (
    thread.messages.filter((message) => message.role === "assistant" && !message.streaming).at(-1)
      ?.text ?? null
  );
}

const DELEGATION_STATE_COPY = {
  running: { label: "Running", colorClassName: "bg-sky-500" },
  needs_review: { label: "Ready to review", colorClassName: "bg-indigo-500" },
  failed: { label: "Needs attention", colorClassName: "bg-destructive" },
} as const;

export function OrchestratorDelegationPanel(props: {
  threads: readonly Thread[];
  onOpenThread: (threadId: ThreadId) => void;
  showOnboarding?: boolean;
  seatModel?: string | null;
}) {
  const [openThreadIds, setOpenThreadIds] = useState<ReadonlySet<ThreadId>>(
    () => new Set(props.threads.map((thread) => thread.id)),
  );
  const knownThreadIdsRef = useRef<ReadonlySet<ThreadId>>(
    new Set(props.threads.map((thread) => thread.id)),
  );

  useEffect(() => {
    const nextKnownThreadIds = new Set(props.threads.map((thread) => thread.id));
    const newThreadIds = props.threads
      .map((thread) => thread.id)
      .filter((threadId) => !knownThreadIdsRef.current.has(threadId));
    knownThreadIdsRef.current = nextKnownThreadIds;
    if (newThreadIds.length === 0) return;
    setOpenThreadIds((current) => new Set([...current, ...newThreadIds]));
  }, [props.threads]);

  if (props.threads.length === 0) {
    if (!props.showOnboarding) return null;

    return (
      <div
        className="mx-auto w-full max-w-[var(--chat-column-max-width)] px-4 pt-3"
        data-testid="orchestrator-onboarding"
      >
        <div className="relative overflow-hidden rounded-xl border border-indigo-500/18 bg-indigo-500/6 px-4 py-3.5 shadow-[0_1px_2px_color-mix(in_srgb,var(--foreground)_4%,transparent)]">
          <div className="pointer-events-none absolute -right-8 -top-10 size-28 rounded-full bg-indigo-400/10 blur-3xl" />
          <div className="relative flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-300">
              <CentralIcon name="agent-network" className="size-[18px]" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h2 className="text-balance text-sm font-medium text-foreground">
                  Orchestrator is ready
                </h2>
                <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-[10px] font-medium text-indigo-700 dark:text-indigo-300">
                  Active
                </span>
              </div>
              <p className="mt-1 text-pretty text-xs leading-5 text-muted-foreground">
                Describe the outcome you want. This seat can plan the work, delegate focused tasks
                to specialist agents in isolated worktrees, and bring their results back for review.
              </p>
              <p className="mt-2 text-[10px] text-muted-foreground/70">
                {props.seatModel ? `Seat model: ${props.seatModel} · ` : ""}Delegation stays visible
                in this thread.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[var(--chat-column-max-width)] space-y-2 px-4 pt-3">
      <div className="flex items-center justify-between px-1">
        <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70">
          Delegated work
        </span>
        <span className="tabular-nums text-[10px] text-muted-foreground/60">
          {props.threads.length} {props.threads.length === 1 ? "task" : "tasks"}
        </span>
      </div>
      {props.threads.map((thread) => {
        const state = delegationState(thread);
        const stateCopy = DELEGATION_STATE_COPY[state];
        const open = openThreadIds.has(thread.id);
        const finalMessage = finalAssistantMessage(thread);
        return (
          <Collapsible
            key={thread.id}
            open={open}
            onOpenChange={(nextOpen) =>
              setOpenThreadIds((current) => {
                const next = new Set(current);
                if (nextOpen) next.add(thread.id);
                else next.delete(thread.id);
                return next;
              })
            }
          >
            <div className="overflow-hidden rounded-xl border border-[color:var(--app-surface-divider)] bg-[var(--color-background-elevated-secondary)] shadow-[0_1px_2px_color-mix(in_srgb,var(--foreground)_3%,transparent)]">
              <CollapsibleTrigger className="flex min-h-11 w-full items-center gap-2.5 px-3 text-left">
                <span
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    stateCopy.colorClassName,
                    state === "running" && "animate-pulse motion-reduce:animate-none",
                  )}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate text-xs font-medium">{thread.title}</span>
                <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">
                  {stateCopy.label}
                </span>
                <DisclosureChevron open={open} className="opacity-70" />
              </CollapsibleTrigger>
              <CollapsiblePanel>
                <div className="border-t border-[color:var(--app-surface-divider)] px-3 py-3">
                  <p className="text-pretty whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
                    {state === "running"
                      ? `Working as ${thread.subagentRole ?? "a delegated specialist"} with ${thread.modelSelection.model} in an isolated worktree.`
                      : state === "failed"
                        ? (thread.error ??
                          (thread.latestTurn?.state === "interrupted"
                            ? "The delegated turn was interrupted before it finished. Open the task to inspect or retry it."
                            : "The delegated turn failed."))
                        : (finalMessage ?? "Delegated work finished and is ready for diff review.")}
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    <Button
                      size="xs"
                      variant={state === "needs_review" ? "default" : "outline"}
                      onClick={() => props.onOpenThread(thread.id)}
                    >
                      {state === "running"
                        ? "Open task"
                        : state === "needs_review"
                          ? "Review changes"
                          : "Inspect failure"}
                    </Button>
                  </div>
                </div>
              </CollapsiblePanel>
            </div>
          </Collapsible>
        );
      })}
    </div>
  );
}
