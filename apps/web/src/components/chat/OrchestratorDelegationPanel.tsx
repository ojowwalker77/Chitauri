import type { ThreadId } from "@t3tools/contracts";
import { useState } from "react";

import type { Thread } from "~/types";
import { cn } from "~/lib/utils";
import { ChevronDownIcon } from "~/lib/icons";
import { Button } from "~/components/ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "~/components/ui/collapsible";

function delegationState(thread: Thread): "running" | "needs_review" | "failed" {
  if (thread.error || thread.latestTurn?.state === "error") return "failed";
  if (thread.session?.status === "running" || thread.latestTurn?.state === "running") {
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

export function OrchestratorDelegationPanel(props: {
  threads: readonly Thread[];
  onOpenThread: (threadId: ThreadId) => void;
}) {
  const [openThreadIds, setOpenThreadIds] = useState<ReadonlySet<ThreadId>>(
    () => new Set(props.threads.map((thread) => thread.id)),
  );

  if (props.threads.length === 0) return null;

  return (
    <div className="mx-auto w-full max-w-[var(--chat-column-max-width)] space-y-2 px-4 pt-3">
      {props.threads.map((thread) => {
        const state = delegationState(thread);
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
            <div className="overflow-hidden rounded-md border border-[color:var(--app-surface-divider)] bg-[var(--color-background-elevated-secondary)]">
              <CollapsibleTrigger className="flex min-h-10 w-full items-center gap-2 px-3 text-left">
                <span
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    state === "running" && "animate-pulse bg-amber-500",
                    state === "needs_review" && "bg-blue-500",
                    state === "failed" && "bg-destructive",
                  )}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate text-xs font-medium">{thread.title}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {thread.subagentRole ?? "delegated"} · {thread.modelSelection.model}
                </span>
                <ChevronDownIcon
                  className={cn("size-3.5 transition-transform duration-200", open && "rotate-180")}
                  aria-hidden
                />
              </CollapsibleTrigger>
              <CollapsiblePanel>
                <div className="border-t border-[color:var(--app-surface-divider)] px-3 py-3">
                  <p className="line-clamp-4 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
                    {state === "running"
                      ? "Delegated work is running in its isolated worktree."
                      : state === "failed"
                        ? (thread.error ?? "The delegated turn failed.")
                        : (finalMessage ?? "Delegated work finished and is ready for diff review.")}
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    <Button
                      size="xs"
                      variant={state === "needs_review" ? "default" : "outline"}
                      onClick={() => props.onOpenThread(thread.id)}
                    >
                      {state === "needs_review" ? "Review diff" : "Open child"}
                    </Button>
                    {state === "needs_review" ? (
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => props.onOpenThread(thread.id)}
                        title="Open the child thread to use its existing handoff controls"
                      >
                        Merge controls
                      </Button>
                    ) : null}
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
