// FILE: liveTranscript.ts
// Purpose: Schemas for Chitauri's live transcript lane (research Phase 1). The lane
// splits high-frequency assistant text into two streams driven from one buffer:
//   * ephemeral, revisioned live updates (immediacy) — replaceable, reconnect-aware;
//   * durable segments (crash recovery + final transcript) — bounded, idempotent.
// This replaces turning every provider micro-delta into a durable orchestration
// event + receipt + full-text projection rewrite.
// Layer: shared contracts (schema-only, no runtime logic)

import { Schema } from "effect";
import { IsoDateTime, MessageId, NonNegativeInt, ThreadId, TurnId } from "./baseSchemas";

// How a runtime event should be persisted. Introduced here so the live lane and the
// Phase 3 activity-classification work share one vocabulary:
//   * durable-fact       — approvals, user input, tool/turn lifecycle, final messages
//   * durable-checkpoint — assistant text segment, crash-recovery sample
//   * ephemeral-latest   — rate-limit/context snapshots, transient status (latest wins)
export const RuntimeEventDurability = Schema.Literals([
  "durable-fact",
  "durable-checkpoint",
  "ephemeral-latest",
]);
export type RuntimeEventDurability = typeof RuntimeEventDurability.Type;

// One coalesced live update for an assistant message. `revision` is monotonic per
// message; `startOffset` is the character offset where `delta` begins, so a client
// can detect duplicates/drops deterministically (a gap where startOffset exceeds
// its current length triggers a scoped snapshot request rather than a full replay).
export const LiveAssistantTextUpdate = Schema.Struct({
  threadId: ThreadId,
  turnId: Schema.NullOr(TurnId),
  messageId: MessageId,
  revision: NonNegativeInt,
  startOffset: NonNegativeInt,
  delta: Schema.String,
  emittedAt: IsoDateTime,
});
export type LiveAssistantTextUpdate = typeof LiveAssistantTextUpdate.Type;

// One durable checkpoint of assistant text. `(messageId, segmentIndex)` is a stable
// identity so replay is idempotent without a per-micro-delta command receipt. The
// full message text is the concatenation of its segments in index order; `final`
// marks the last segment (emitted by the forced terminal flush, possibly empty).
export const LiveAssistantSegment = Schema.Struct({
  threadId: ThreadId,
  turnId: Schema.NullOr(TurnId),
  messageId: MessageId,
  segmentIndex: NonNegativeInt,
  startOffset: NonNegativeInt,
  text: Schema.String,
  final: Schema.Boolean,
});
export type LiveAssistantSegment = typeof LiveAssistantSegment.Type;

// Reconnect payload: the durably-committed length plus the current live tail and
// revision, so a client can reconcile without replaying history. `complete` is true
// once the message has been finalized.
export const LiveAssistantSnapshot = Schema.Struct({
  threadId: ThreadId,
  turnId: Schema.NullOr(TurnId),
  messageId: MessageId,
  revision: NonNegativeInt,
  committedLength: NonNegativeInt,
  text: Schema.String,
  complete: Schema.Boolean,
});
export type LiveAssistantSnapshot = typeof LiveAssistantSnapshot.Type;
