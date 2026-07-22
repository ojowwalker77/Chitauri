// FILE: ToolCallDetailsDialog.tsx
// Purpose: Modal inspector for command and file-change tool calls from transcript rows.
// Layer: Chat presentation component
// Exports: ToolCallDetailsDialog
// Depends on: WorkLogEntry.toolDetails and shared dialog chrome

import type { ReactNode } from "react";
import { PencilIcon, TerminalIcon } from "~/lib/icons";
import { createMarkdownCodeFence, formatShellTranscript } from "~/lib/toolCallDetailsFormatting";
import { cn } from "~/lib/utils";
import type { WorkLogToolDetails, WorkLogToolOutputDetails } from "../../lib/toolCallDetails";
import type { WorkLogEntry } from "../../session-logic";
import ChatMarkdown from "../ChatMarkdown";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";

const DETAIL_HEADER_CLASS_NAME = "border-b border-border px-3 py-2 text-xs font-medium";
const DETAIL_CODE_BLOCK_CLASS_NAME =
  "max-h-[min(46vh,30rem)] overflow-auto whitespace-pre-wrap break-words font-chat-code text-xs leading-relaxed text-foreground";
const TOOL_DETAILS_MARKDOWN_CLASS_NAME =
  "text-[length:var(--app-font-size-ui,14px)] leading-relaxed";

interface ToolCallDetailsDialogProps {
  entry: WorkLogEntry | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ToolCallDetailsDialog({ entry, open, onOpenChange }: ToolCallDetailsDialogProps) {
  const details = entry?.toolDetails;
  // Mirror the transcript row's icon mapping (workEntryIcon): file-change edits use
  // the central pencil, commands use the terminal — so the dialog header matches
  // the row the user clicked.
  const Icon = details?.kind === "file-change" ? PencilIcon : TerminalIcon;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup surface="solid" className="max-h-[min(86vh,760px)] max-w-4xl gap-0 p-0">
        <DialogHeader className="border-b border-border pr-10">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-background text-faint">
              <Icon className="size-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate text-base">
                {details?.title ?? "Tool call"}
              </DialogTitle>
              <DialogDescription>
                {details?.kind === "file-change"
                  ? "Edit payload captured for this tool call."
                  : "Command payload captured for this tool call."}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <DialogPanel
          className="max-h-[min(72vh,620px)] space-y-4 px-4 py-4"
          data-tool-details-dialog="true"
        >
          <ToolCallDetailsContent details={details} />
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

export function ToolCallDetailsContent({ details }: { details: WorkLogToolDetails | undefined }) {
  if (!details) {
    return (
      <div className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
        No detailed payload was available for this tool call.
      </div>
    );
  }

  return (
    <>
      {details.command ? (
        <div className="space-y-2">
          <MarkdownToolCodeBlock language="bash">
            {formatShellTranscript(details.command, details.output)}
          </MarkdownToolCodeBlock>
          {details.output ? <ToolOutputMetadata output={details.output} /> : null}
        </div>
      ) : null}

      {details.files?.length ? (
        <ToolDetailSection title="Files">
          <div className="flex flex-wrap gap-1.5">
            {details.files.map((file) => (
              <span
                key={file}
                className="max-w-full rounded-md border border-border bg-background px-2 py-1 font-chat-code text-xs text-foreground"
                title={file}
              >
                {file}
              </span>
            ))}
          </div>
        </ToolDetailSection>
      ) : null}

      {details.diff ? (
        <ToolDetailSection title="Diff">
          <DiffCodeBlock>{details.diff}</DiffCodeBlock>
        </ToolDetailSection>
      ) : null}

      {details.edits?.length ? (
        <ToolDetailSection title="Edits">
          <div className="space-y-3">
            {details.edits.map((edit, index) => (
              <div
                key={`${edit.path ?? "edit"}:${index}`}
                className="overflow-hidden rounded-lg border border-border bg-background"
              >
                {edit.path ? (
                  <div className="border-b border-border px-3 py-2 font-chat-code text-xs text-muted-foreground">
                    {edit.path}
                  </div>
                ) : null}
                <div className="grid gap-0 md:grid-cols-2">
                  {edit.oldText !== undefined ? (
                    <TextChangeBlock title="Before" tone="remove">
                      {edit.oldText}
                    </TextChangeBlock>
                  ) : null}
                  {edit.newText !== undefined ? (
                    <TextChangeBlock title="After" tone="add">
                      {edit.newText}
                    </TextChangeBlock>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </ToolDetailSection>
      ) : null}

      {details.content ? (
        <ToolDetailSection title="Written Content">
          <MarkdownToolCodeBlock language="text">{details.content}</MarkdownToolCodeBlock>
        </ToolDetailSection>
      ) : null}

      {details.output && !details.command ? <ToolOutputSection output={details.output} /> : null}
    </>
  );
}

function MarkdownToolCodeBlock(props: { language: string; children: string }) {
  return (
    <ChatMarkdown
      text={createMarkdownCodeFence(props.language, props.children)}
      cwd={undefined}
      className={TOOL_DETAILS_MARKDOWN_CLASS_NAME}
    />
  );
}

function ToolDetailSection(props: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-medium text-faint">{props.title}</h3>
      {props.children}
    </section>
  );
}

function ToolOutputMetadata({ output }: { output: WorkLogToolOutputDetails }) {
  if (output.exitCode === undefined && !output.truncated) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      {output.exitCode !== undefined ? (
        <span className="rounded-full border border-border px-2 py-0.5">
          Exit code {output.exitCode}
        </span>
      ) : null}
      {output.truncated ? (
        <span className="rounded-full border border-info/30 bg-info/10 px-2 py-0.5 text-info">
          Truncated
        </span>
      ) : null}
    </div>
  );
}

function ToolOutputSection({ output }: { output: WorkLogToolOutputDetails }) {
  return (
    <ToolDetailSection title="Output">
      <div className="space-y-3">
        {output.output ? (
          <MarkdownToolCodeBlock language="text">{output.output}</MarkdownToolCodeBlock>
        ) : null}
        {output.stdout ? (
          <LabeledCodeBlock title="Stdout" tone="output">
            {output.stdout}
          </LabeledCodeBlock>
        ) : null}
        {output.stderr ? (
          <LabeledCodeBlock title="Stderr" tone="error">
            {output.stderr}
          </LabeledCodeBlock>
        ) : null}
        <ToolOutputMetadata output={output} />
      </div>
    </ToolDetailSection>
  );
}

function LabeledCodeBlock(props: { title: string; tone: "output" | "error"; children: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-background">
      <div
        className={cn(
          DETAIL_HEADER_CLASS_NAME,
          props.tone === "error" ? "text-destructive" : "text-faint",
        )}
      >
        {props.title}
      </div>
      <ToolCodeBlock bare>{props.children}</ToolCodeBlock>
    </div>
  );
}

function TextChangeBlock(props: { title: string; tone: "add" | "remove"; children: string }) {
  return (
    <div
      className={cn(
        "min-w-0 border-border md:[&:not(:first-child)]:border-l",
        props.tone === "add"
          ? "bg-[color-mix(in_srgb,var(--success)_6%,transparent)]"
          : "bg-[color-mix(in_srgb,var(--destructive)_6%,transparent)]",
      )}
    >
      <div
        className={cn(
          DETAIL_HEADER_CLASS_NAME,
          props.tone === "add" ? "text-success-foreground" : "text-destructive",
        )}
      >
        {props.title}
      </div>
      <ToolCodeBlock bare>{props.children}</ToolCodeBlock>
    </div>
  );
}

function ToolCodeBlock(props: { children: string; tone?: "default" | "command"; bare?: boolean }) {
  return (
    <pre
      className={cn(
        DETAIL_CODE_BLOCK_CLASS_NAME,
        props.tone === "command" && "text-foreground",
        props.bare ? "px-3 py-2.5" : "rounded-lg border border-border bg-background px-3 py-2.5",
      )}
    >
      {props.children}
    </pre>
  );
}

function DiffCodeBlock({ children }: { children: string }) {
  const lines = children.split(/\r?\n/);
  return (
    <pre className="max-h-[min(52vh,34rem)] overflow-auto rounded-lg border border-border bg-background px-0 py-2 font-chat-code text-xs leading-relaxed">
      {lines.map((line, index) => (
        <span
          key={`${index}:${line.slice(0, 24)}`}
          className={cn(
            "block min-w-max whitespace-pre-wrap break-words px-3",
            line.startsWith("+") && !line.startsWith("+++")
              ? "bg-[color-mix(in_srgb,var(--success)_8%,transparent)] text-success-foreground"
              : null,
            line.startsWith("-") && !line.startsWith("---")
              ? "bg-[color-mix(in_srgb,var(--destructive)_8%,transparent)] text-destructive"
              : null,
            line.startsWith("@@") ? "text-muted-foreground" : null,
            /^(diff --git|index |--- |\+\+\+ )/.test(line) ? "text-faint" : null,
          )}
        >
          {line.length > 0 ? line : " "}
        </span>
      ))}
    </pre>
  );
}
