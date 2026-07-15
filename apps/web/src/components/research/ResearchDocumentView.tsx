// FILE: ResearchDocumentView.tsx
// Purpose: Polished Markdown/HTML research reader with a clickable reference rail.
// Layer: Web research presentation

import type { ResearchDocument, ResearchReference } from "@t3tools/contracts";

import ChatMarkdown from "~/components/ChatMarkdown";
import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";
import { openInPreferredEditor } from "~/editorPreferences";
import {
  ArrowUpRightIcon,
  ExternalLinkIcon,
  FileIcon,
  GitBranchIcon,
  HammerIcon,
  LinkIcon,
} from "~/lib/icons";
import { cn } from "~/lib/utils";
import { ensureNativeApi } from "~/nativeApi";

function formattedDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function referenceIcon(reference: ResearchReference) {
  if (reference.kind === "file") return FileIcon;
  if (reference.kind === "url" || reference.kind === "issue" || reference.kind === "pull-request") {
    return LinkIcon;
  }
  return HammerIcon;
}

async function openReference(reference: ResearchReference): Promise<void> {
  const api = ensureNativeApi();
  try {
    if (
      reference.kind === "url" ||
      reference.kind === "issue" ||
      reference.kind === "pull-request" ||
      /^https?:\/\//i.test(reference.target)
    ) {
      await api.shell.openExternal(reference.target);
      return;
    }
    if (reference.kind === "file") {
      await openInPreferredEditor(api, reference.target);
      return;
    }
    await navigator.clipboard.writeText(reference.target);
    toastManager.add({ type: "success", title: "Reference copied" });
  } catch (error) {
    toastManager.add({
      type: "error",
      title: "Could not open reference",
      description: error instanceof Error ? error.message : reference.target,
    });
  }
}

function ReferenceRail({ references }: { references: readonly ResearchReference[] }) {
  return (
    <aside className="min-w-0 xl:sticky xl:top-0 xl:h-fit" aria-label="Research references">
      <div className="rounded-2xl bg-[var(--color-background-surface)] p-2 shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-border)_72%,transparent),0_10px_30px_-22px_rgba(0,0,0,0.45)]">
        <div className="px-2 pb-2 pt-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            References
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {references.length === 0
              ? "No sources recorded yet"
              : `${references.length} source${references.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <div className="flex flex-col gap-1">
          {references.map((reference) => {
            const Icon = referenceIcon(reference);
            return (
              <button
                key={reference.id}
                type="button"
                onClick={() => void openReference(reference)}
                className="group flex min-h-11 w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition-[background-color,box-shadow,transform] duration-150 ease-out hover:bg-[var(--color-background-elevated-secondary)] hover:shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-border)_62%,transparent)] active:scale-[0.96] motion-reduce:transition-none"
              >
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-[var(--color-background-elevated-secondary)] text-muted-foreground">
                  <Icon className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1 text-xs font-medium text-foreground">
                    <span className="min-w-0 truncate">{reference.label}</span>
                    <ExternalLinkIcon className="size-3 shrink-0 opacity-0 transition-opacity duration-150 group-hover:opacity-60" />
                  </span>
                  {reference.description ? (
                    <span className="mt-0.5 line-clamp-2 block text-[11px] leading-4 text-muted-foreground text-pretty">
                      {reference.description}
                    </span>
                  ) : null}
                  <span className="mt-1 block truncate font-mono text-[10px] text-muted-foreground/70">
                    {reference.line ? `${reference.target}:${reference.line}` : reference.target}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}

export function ResearchDocumentView({
  document,
  applying,
  onApply,
}: {
  document: ResearchDocument;
  applying: boolean;
  onApply: () => void;
}) {
  const markdownCwd = document.worktreePath ?? document.repositoryRoot ?? undefined;
  return (
    <div className="research-document-scroll min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(circle_at_50%_-20%,color-mix(in_srgb,var(--color-accent)_9%,transparent),transparent_38%)]">
      <div className="mx-auto grid w-full max-w-[92rem] gap-6 px-4 pb-16 pt-5 sm:px-6 lg:px-8 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <article className="min-w-0 overflow-hidden rounded-[24px] bg-[var(--color-background-surface)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-border)_70%,transparent),0_26px_80px_-54px_rgba(0,0,0,0.65)]">
          <header className="flex flex-col gap-5 px-6 pb-6 pt-7 sm:px-9 sm:pt-9 lg:px-12">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="rounded-full bg-[var(--color-background-elevated-secondary)] px-2.5 py-1 font-medium uppercase tracking-[0.12em]">
                    {document.format === "html" ? "Interactive brief" : "Research plan"}
                  </span>
                  <span>{document.repositoryName}</span>
                  {document.branch ? (
                    <span className="inline-flex items-center gap-1">
                      <GitBranchIcon className="size-3" />
                      {document.branch}
                    </span>
                  ) : null}
                </div>
                <h1 className="max-w-4xl text-balance font-heading text-3xl font-semibold leading-[1.08] tracking-[-0.03em] text-foreground sm:text-4xl">
                  {document.title}
                </h1>
                {document.summary ? (
                  <p className="mt-3 max-w-3xl text-pretty text-sm leading-6 text-muted-foreground sm:text-base">
                    {document.summary}
                  </p>
                ) : null}
              </div>
              <Button
                type="button"
                onClick={onApply}
                disabled={applying}
                className="min-h-10 shrink-0 gap-2 pl-3.5 pr-3 transition-transform active:scale-[0.96]"
              >
                <HammerIcon className="size-4" />
                {applying ? "Starting…" : "Apply in new thread"}
                <ArrowUpRightIcon className="size-3.5" />
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/60 pt-4 text-[11px] text-muted-foreground">
              <span className="tabular-nums">Updated {formattedDate(document.updatedAt)}</span>
              <span className="truncate font-mono">{document.storagePath}</span>
              {document.tags.map((tag) => (
                <span key={tag} className="rounded-full bg-muted/60 px-2 py-0.5">
                  {tag}
                </span>
              ))}
            </div>
          </header>

          <div
            className={cn(
              "border-t border-border/60",
              document.format === "html" && "bg-muted/20 p-2 sm:p-3",
            )}
          >
            {document.format === "html" ? (
              <iframe
                title={document.title}
                srcDoc={document.content}
                sandbox=""
                referrerPolicy="no-referrer"
                className="h-[max(46rem,calc(100vh-15rem))] w-full rounded-[16px] bg-white outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
              />
            ) : (
              <div className="mx-auto max-w-4xl px-6 py-8 sm:px-9 sm:py-10 lg:px-12">
                <ChatMarkdown
                  text={document.content}
                  cwd={markdownCwd}
                  className="research-markdown text-[15px] leading-7 sm:text-base"
                />
              </div>
            )}
          </div>
        </article>
        <ReferenceRail references={document.references} />
      </div>
    </div>
  );
}
