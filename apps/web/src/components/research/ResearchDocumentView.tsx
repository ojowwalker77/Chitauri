// FILE: ResearchDocumentView.tsx
// Purpose: Reading-first Markdown research view with direct editing and a clickable reference rail.
// Layer: Web research presentation

import type { ResearchDocument, ResearchReference } from "@t3tools/contracts";

import ChatMarkdown from "~/components/ChatMarkdown";
import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";
import { openInPreferredEditor } from "~/editorPreferences";
import {
  ArchiveIcon,
  ArrowUpRightIcon,
  ExternalLinkIcon,
  FileIcon,
  GitBranchIcon,
  HammerIcon,
  LinkIcon,
  PencilIcon,
  RotateCcwIcon,
} from "~/lib/icons";
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
      <div className="rounded-xl border border-panel-border bg-panel p-2">
        <div className="px-2 pb-2 pt-1">
          <p className="text-xs font-semibold uppercase text-muted-foreground">References</p>
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
                className="group flex min-h-11 w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-[background-color,scale] duration-press ease-out hover:bg-hover active:scale-[0.96] motion-reduce:transition-none"
              >
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-[var(--color-background-elevated-secondary)] text-muted-foreground">
                  <Icon className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1 text-xs font-medium text-foreground">
                    <span className="min-w-0 truncate">{reference.label}</span>
                    <ExternalLinkIcon className="size-3.5 shrink-0 opacity-0 transition-opacity duration-150 group-hover:opacity-60" />
                  </span>
                  {reference.description ? (
                    <span className="mt-0.5 line-clamp-2 block text-xs leading-4 text-muted-foreground text-pretty">
                      {reference.description}
                    </span>
                  ) : null}
                  <span className="mt-1 block truncate font-mono text-xs text-muted-foreground">
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
  archiving,
  onApply,
  onArchiveChange,
}: {
  document: ResearchDocument;
  applying: boolean;
  archiving: boolean;
  onApply: () => void;
  onArchiveChange: (archived: boolean) => void;
}) {
  const markdownCwd = document.worktreePath ?? document.repositoryRoot ?? undefined;
  const editMarkdown = async () => {
    try {
      await openInPreferredEditor(ensureNativeApi(), document.documentPath);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not open Markdown editor",
        description: error instanceof Error ? error.message : document.documentPath,
      });
    }
  };

  return (
    <div className="research-document-scroll min-h-0 flex-1 overflow-y-auto bg-background">
      {/* The composer overlays the bottom of this surface, so the document has to
          scroll clear of it. `--chat-composer-inset` is the composer's measured
          height, published by ChatView; without it the last lines of the document
          sit permanently underneath and read as cut off. */}
      <div className="mx-auto grid w-full max-w-[92rem] gap-6 px-4 pt-5 pb-[calc(4rem+var(--chat-composer-inset,0px))] sm:px-6 lg:px-8 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <article className="min-w-0 overflow-hidden rounded-xl border border-panel-border bg-panel">
          <header className="flex flex-col gap-5 px-6 pb-6 pt-7 sm:px-9 sm:pt-9 lg:px-12">
            <div className="flex flex-wrap items-start justify-between gap-5">
              {/* A real flex-basis, not just `flex-1`: with `flex: 1 1 0%` the
                  browser measures this column as zero when deciding whether the
                  row fits, so it never wrapped the actions to their own line and
                  instead squeezed the title down to one word per line. */}
              <div className="min-w-0 flex-1 basis-[26rem]">
                <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="rounded-full bg-selected px-2.5 py-1 font-medium">
                    {document.archivedAt ? "Archived Markdown" : "Markdown research"}
                  </span>
                  <span>{document.repositoryName}</span>
                  {document.branch ? (
                    <span className="inline-flex items-center gap-1">
                      <GitBranchIcon className="size-3.5" />
                      {document.branch}
                    </span>
                  ) : null}
                </div>
                <h1 className="max-w-4xl text-balance text-2xl font-medium leading-tight text-foreground">
                  {document.title}
                </h1>
                {document.summary ? (
                  <p className="mt-3 max-w-3xl text-pretty text-sm leading-6 text-muted-foreground sm:text-base">
                    {document.summary}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Button
                  type="button"
                  onClick={() => void editMarkdown()}
                  className="min-h-10 gap-2 px-3.5"
                >
                  <PencilIcon className="size-3.5" />
                  Edit Markdown
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={onApply}
                  disabled={applying}
                  className="min-h-10 gap-2 pl-3.5 pr-3"
                >
                  <HammerIcon className="size-3.5" />
                  {applying ? "Starting…" : "Apply in new thread"}
                  <ArrowUpRightIcon className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => onArchiveChange(document.archivedAt === null)}
                  disabled={archiving}
                  className="min-h-10 gap-2 px-3"
                >
                  {document.archivedAt ? (
                    <RotateCcwIcon className={archiving ? "size-3.5 animate-spin" : "size-3.5"} />
                  ) : (
                    <ArchiveIcon className={archiving ? "size-3.5 animate-pulse" : "size-3.5"} />
                  )}
                  {document.archivedAt ? "Restore" : "Archive"}
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-4 text-xs text-muted-foreground">
              <span className="tabular-nums">Updated {formattedDate(document.updatedAt)}</span>
              <span className="truncate font-mono">{document.storagePath}</span>
              {document.tags.map((tag) => (
                <span key={tag} className="rounded-full bg-muted px-2 py-0.5">
                  {tag}
                </span>
              ))}
            </div>
          </header>

          <div className="border-t border-border">
            <div className="mx-auto max-w-4xl px-6 py-8 sm:px-9 sm:py-10 lg:px-12">
              <ChatMarkdown
                text={document.content}
                cwd={markdownCwd}
                className="research-markdown text-base leading-7 sm:text-base"
              />
            </div>
          </div>
        </article>
        <ReferenceRail references={document.references} />
      </div>
    </div>
  );
}
