import type { ThreadId } from "@t3tools/contracts";
import { useEffect, useRef, useState, type Ref } from "react";

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
  running: { label: "Running", colorClassName: "bg-claude" },
  needs_review: { label: "Ready to review", colorClassName: "bg-success" },
  failed: { label: "Needs attention", colorClassName: "bg-destructive" },
} as const;

const SEAT_STATUS_COPY = {
  pending: {
    label: "Waiting for delegation tools",
    detail: "The provider is connecting to the delegation control plane.",
    dotClassName: "bg-muted-foreground/55",
  },
  connected: {
    label: "Connected — delegation tools armed",
    detail: "Implementation work will be delegated to specialist agents in isolated worktrees.",
    dotClassName: "bg-success",
  },
  degraded: {
    label: "Delegation unavailable",
    detail:
      "This turn can continue, but the seat cannot delegate until its control plane is available.",
    dotClassName: "bg-gold",
  },
} as const;

type SeatStatus = keyof typeof SEAT_STATUS_COPY;

export function OrchestratorDelegationPanel(props: {
  threads: readonly Thread[];
  onOpenThread: (threadId: ThreadId) => void;
  showOnboarding?: boolean;
  seatModel?: string | null;
  seatStatus?: SeatStatus;
  seatStatusReason?: string | null;
  laneRoutes?: ReadonlyArray<{ readonly lane: string; readonly model: string }>;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  panelRef?: Ref<HTMLDivElement>;
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

  const [uncontrolledOpen, setUncontrolledOpen] = useState(
    () => props.showOnboarding === true || props.threads.length > 0,
  );
  const open = props.open ?? uncontrolledOpen;
  const setOpen = (nextOpen: boolean) => {
    props.onOpenChange?.(nextOpen);
    if (props.open === undefined) {
      setUncontrolledOpen(nextOpen);
    }
  };
  const seatStatus = props.seatStatus ?? "pending";
  const seatStatusCopy = SEAT_STATUS_COPY[seatStatus];

  return (
    <div
      ref={props.panelRef}
      className="mx-auto w-full max-w-[var(--chat-column-max-width)] px-4 pt-3"
      data-testid="orchestrator-delegation-panel"
    >
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="relative overflow-hidden rounded-xl border border-panel-border bg-panel">
          <CollapsibleTrigger className="relative flex min-h-12 w-full items-center gap-3 px-4 text-left transition-[background-color,scale] duration-press ease-out hover:bg-hover active:scale-[0.96] motion-reduce:active:scale-100">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-selected text-claude">
              <CentralIcon name="agent-network" className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="text-sm font-medium text-foreground">
                  {props.showOnboarding ? "Orchestrator is ready" : "Delegation control"}
                </span>
                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                  <span className={cn("size-1.5 rounded-full", seatStatusCopy.dotClassName)} />
                  {seatStatusCopy.label}
                </span>
              </span>
              <span className="mt-0.5 block truncate text-[11px] text-muted-foreground/80">
                {props.threads.length} {props.threads.length === 1 ? "delegation" : "delegations"}
                {props.seatModel ? ` · Seat: ${props.seatModel}` : ""}
              </span>
            </span>
            <DisclosureChevron open={open} className="opacity-70" />
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <div className="relative border-t border-panel-border px-4 py-3.5">
              <p className="text-pretty text-xs leading-5 text-muted-foreground">
                {seatStatus === "degraded" && props.seatStatusReason
                  ? props.seatStatusReason
                  : seatStatusCopy.detail}
              </p>
              {props.laneRoutes && props.laneRoutes.length > 0 ? (
                <div className="mt-3 grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
                  {props.laneRoutes.map((route) => (
                    <div
                      key={route.lane}
                      className="flex min-w-0 items-center gap-2 text-[11px]"
                    >
                      <span className="w-11 shrink-0 font-medium text-foreground/80">
                        {route.lane}
                      </span>
                      <span className="min-w-0 truncate font-mono text-muted-foreground">
                        {route.model}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
              {props.threads.length === 0 ? (
                <p className="mt-3 text-pretty text-xs leading-5 text-muted-foreground">
                  Describe the outcome you want. This seat plans the work, delegates focused tasks,
                  and returns their diffs for review here.
                </p>
              ) : (
                <div className="mt-3 space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-[11px] font-medium uppercase tracking-[0.07em] text-muted-foreground/80">
                      Delegated work
                    </span>
                    <span className="tabular-nums text-[11px] text-muted-foreground/70">
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
                        <div className="overflow-hidden rounded-[11px] border border-panel-border bg-[var(--color-background-elevated-secondary)]">
                          <CollapsibleTrigger className="flex min-h-11 w-full items-center gap-2.5 px-3 text-left transition-[background-color,scale] duration-press ease-out hover:bg-hover active:scale-[0.96] motion-reduce:active:scale-100">
                            <span
                              className={cn(
                                "size-2 shrink-0 rounded-full",
                                stateCopy.colorClassName,
                              )}
                              aria-hidden
                            />
                            <span className="min-w-0 flex-1 truncate text-xs font-medium">
                              {thread.title}
                            </span>
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
                                    : (finalMessage ??
                                      "Delegated work finished and is ready for diff review.")}
                              </p>
                              <div className="mt-3 flex items-center gap-2">
                                <Button
                                  size="xs"
                                  variant="outline"
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
              )}
            </div>
          </CollapsiblePanel>
        </div>
      </Collapsible>
    </div>
  );
}
