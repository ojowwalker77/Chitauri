// FILE: WorkerChannelCard.tsx
// Purpose: The transcript artifact for an open cross-Worker request channel.
// Layer: Chat presentation
// Exports: WorkerChannelCard

import { useState } from "react";

import { DisclosureRegion } from "~/components/ui/DisclosureRegion";
import { disclosureChevronClassName } from "~/lib/disclosureMotion";
import {
  ChatBubbleIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleCheckIcon,
  ExternalLinkIcon,
  InboxIcon,
  LoaderIcon,
  XIcon,
} from "~/lib/icons";
import { cn } from "~/lib/utils";
import { isWorkerChannelOpen, type WorkerChannelView } from "./workerChannel";

interface WorkerChannelCardProps {
  channel: WorkerChannelView;
  chatMetaFontSizePx: number;
  onOpenPeerThread?: ((channel: WorkerChannelView) => void) | undefined;
  onCloseChannel?: ((channel: WorkerChannelView) => void) | undefined;
}

// Status drives one pill, not a colour scheme: the blueprint has three inks, so
// the only status that earns a colour is the terminal one.
function statusLabel(channel: WorkerChannelView): string {
  switch (channel.status) {
    case "waiting":
      return channel.side === "requester" ? "Waiting" : "Open";
    case "answered":
      return channel.side === "requester" ? "Replied" : "You replied";
    case "closed":
      return "Closed";
    case "cancelled":
      return "Cancelled";
  }
}

export function WorkerChannelCard({
  channel,
  chatMetaFontSizePx,
  onOpenPeerThread,
  onCloseChannel,
}: WorkerChannelCardProps) {
  // Collapsed once answered: a settled channel is a record, and an open one is
  // the thing the reader is waiting on.
  const [expanded, setExpanded] = useState(channel.status === "waiting");
  const open = isWorkerChannelOpen(channel.status);
  const waiting = channel.status === "waiting";
  const HeadIcon = channel.side === "requester" ? ChatBubbleIcon : InboxIcon;
  const metaStyle = { fontSize: `${chatMetaFontSizePx}px` };

  return (
    <div className="my-1 overflow-hidden rounded-xl border border-border bg-panel">
      <button
        type="button"
        className="flex w-full items-center gap-2.5 px-3.5 py-3 text-left hover:bg-hover"
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
      >
        <HeadIcon className="size-5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">
            {channel.subject}
          </span>
          <span className="block truncate text-faint" style={metaStyle}>
            {channel.side === "requester"
              ? `Channel with ${channel.peerWorkerTitle}`
              : `Request from ${channel.peerWorkerTitle}`}
            {channel.messages.length > 0 ? ` · ${channel.messages.length} messages` : ""}
          </span>
        </span>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2 py-0.5",
            channel.status === "closed" ? "text-muted-foreground" : "text-foreground",
          )}
          style={metaStyle}
        >
          {waiting ? (
            <LoaderIcon className="size-3.5 animate-spin" />
          ) : channel.status === "closed" ? (
            <CircleCheckIcon className="size-3.5" />
          ) : (
            <CheckIcon className="size-3.5" />
          )}
          {statusLabel(channel)}
        </span>
        <ChevronDownIcon
          className={disclosureChevronClassName(expanded, "size-3.5 shrink-0 text-faint")}
        />
      </button>

      <DisclosureRegion open={expanded}>
        <div className="border-t border-border px-3.5 py-1">
          <ChannelMessage
            who={channel.side === "requester" ? "You asked" : `${channel.peerWorkerTitle} asked`}
            text={channel.ask}
            metaStyle={metaStyle}
          />
          {channel.messages
            .filter((message) => message.kind === "reply")
            .map((message) => (
              <ChannelMessage
                key={message.id}
                who={
                  channel.side === "requester"
                    ? `${channel.peerWorkerTitle} replied`
                    : "You replied"
                }
                text={message.text}
                metaStyle={metaStyle}
              />
            ))}
          {waiting && channel.side === "requester" ? (
            <div
              className="flex items-center gap-2 border-t border-border py-2.5 text-faint"
              style={metaStyle}
            >
              <LoaderIcon className="size-3.5 animate-spin" />
              {channel.peerWorkerTitle} is working on it
            </div>
          ) : null}
        </div>
      </DisclosureRegion>

      <div className="flex items-center gap-2 border-t border-border px-3.5 py-2.5">
        <span className="flex-1 text-faint" style={metaStyle}>
          {open
            ? channel.side === "responder"
              ? "Answer from this repository only"
              : "Channel stays open until one side closes it"
            : "Channel closed"}
        </span>
        {channel.peerThreadId && onOpenPeerThread ? (
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-muted-foreground hover:bg-hover hover:text-foreground"
            style={metaStyle}
            onClick={() => onOpenPeerThread(channel)}
          >
            <ExternalLinkIcon className="size-3.5" />
            Open {channel.peerWorkerTitle}
          </button>
        ) : null}
        {open && onCloseChannel ? (
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-muted-foreground hover:bg-hover hover:text-foreground"
            style={metaStyle}
            onClick={() => onCloseChannel(channel)}
          >
            <XIcon className="size-3.5" />
            Close channel
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ChannelMessage(props: { who: string; text: string; metaStyle: { fontSize: string } }) {
  return (
    <div className="border-border py-2.5 not-first:border-t">
      <div className="mb-1 text-muted-foreground" style={props.metaStyle}>
        {props.who}
      </div>
      <div className="text-sm leading-relaxed whitespace-pre-wrap text-foreground">
        {props.text}
      </div>
    </div>
  );
}
