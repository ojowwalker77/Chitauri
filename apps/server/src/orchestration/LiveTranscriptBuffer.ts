// FILE: LiveTranscriptBuffer.ts
// Purpose: The core of the live transcript lane (research Phase 1). One buffer per
// active assistant message coalesces provider micro-deltas into two streams:
//   * ephemeral live updates — emitted at most once per `liveEmitIntervalMs` (or
//     immediately once `liveEmitSizeBytes` is pending), revisioned and replaceable.
//   * durable segments — checkpointed every `segmentIntervalMs` or `segmentSizeBytes`
//     (whichever first), each a bounded, stably-indexed slice, with a forced final
//     flush before completion/interruption/exit/stop/shutdown.
// The full message text is exactly the concatenation of its segment texts in index
// order, so replay is idempotent and the durable count is O(bytes/segmentSize +
// timed checkpoints) rather than O(provider chunk count).
// This module is pure and clock-injected; the owning ingestion layer forwards live
// updates to the WS live lane and segments to the durable projection.
// Layer: Server orchestration (live transcript lane)

import type {
  LiveAssistantSegment,
  LiveAssistantSnapshot,
  LiveAssistantTextUpdate,
  MessageId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";

export interface LiveTranscriptBufferConfig {
  // Coalesce live updates to at most one per this many ms...
  readonly liveEmitIntervalMs: number;
  // ...unless this many uncoalesced characters are pending, then emit immediately.
  readonly liveEmitSizeBytes: number;
  // Persist a durable segment at least this often while text is pending...
  readonly segmentIntervalMs: number;
  // ...or once this many uncheckpointed characters accumulate. Also the max size of
  // a single segment, so one huge delta is split into bounded segments.
  readonly segmentSizeBytes: number;
}

// Initial safety values from the research: bound process-crash exposure while
// collapsing thousands of provider chunks into tens of durable segments. Tunable.
export const DEFAULT_LIVE_TRANSCRIPT_CONFIG: LiveTranscriptBufferConfig = {
  liveEmitIntervalMs: 60,
  liveEmitSizeBytes: 512,
  segmentIntervalMs: 250,
  segmentSizeBytes: 4096,
};

export interface LiveMessageIdentity {
  readonly threadId: ThreadId;
  readonly turnId: TurnId | null;
  readonly messageId: MessageId;
}

export interface LiveTranscriptEmissions {
  readonly liveUpdates: readonly LiveAssistantTextUpdate[];
  readonly segments: readonly LiveAssistantSegment[];
}

const EMPTY_EMISSIONS: LiveTranscriptEmissions = { liveUpdates: [], segments: [] };

// Per-message accumulator. Tracks how much text has been revealed live vs. durably
// checkpointed; each cursor advances contiguously so segment concatenation exactly
// reconstructs the message.
class LiveMessageAccumulator {
  private text = "";
  private liveEmittedLength = 0;
  private committedLength = 0;
  private revision = 0;
  private segmentIndex = 0;
  private lastLiveEmitAtMs: number;
  private lastSegmentAtMs: number;
  private finalized = false;

  constructor(
    private readonly identity: LiveMessageIdentity,
    private readonly config: LiveTranscriptBufferConfig,
    createdAtMs: number,
  ) {
    this.lastLiveEmitAtMs = createdAtMs;
    this.lastSegmentAtMs = createdAtMs;
  }

  get isFinalized(): boolean {
    return this.finalized;
  }

  append(delta: string, nowMs: number): LiveTranscriptEmissions {
    if (this.finalized || delta.length === 0) {
      return this.flushDue(nowMs);
    }
    this.text += delta;
    return this.flushDue(nowMs);
  }

  poll(nowMs: number): LiveTranscriptEmissions {
    if (this.finalized) {
      return EMPTY_EMISSIONS;
    }
    return this.flushDue(nowMs);
  }

  // Forced flush on any terminal path: reveal the remaining live tail and persist a
  // final segment (marked `final`, possibly empty) so the message is always closed
  // durably. Idempotent — a second call is a no-op.
  finalize(nowMs: number): LiveTranscriptEmissions {
    if (this.finalized) {
      return EMPTY_EMISSIONS;
    }
    this.finalized = true;

    const liveUpdates: LiveAssistantTextUpdate[] = [];
    if (this.text.length > this.liveEmittedLength) {
      liveUpdates.push(this.emitLive(nowMs));
    }

    const segments: LiveAssistantSegment[] = [];
    while (this.text.length - this.committedLength > this.config.segmentSizeBytes) {
      segments.push(this.emitSegment(this.config.segmentSizeBytes, false, nowMs));
    }
    // Always emit exactly one final segment covering the remaining tail.
    segments.push(this.emitSegment(this.text.length - this.committedLength, true, nowMs));

    return { liveUpdates, segments };
  }

  snapshot(): LiveAssistantSnapshot {
    return {
      threadId: this.identity.threadId,
      turnId: this.identity.turnId,
      messageId: this.identity.messageId,
      revision: this.revision,
      committedLength: this.committedLength,
      text: this.text,
      complete: this.finalized,
    };
  }

  private flushDue(nowMs: number): LiveTranscriptEmissions {
    const liveUpdates: LiveAssistantTextUpdate[] = [];
    const segments: LiveAssistantSegment[] = [];

    const livePending = this.text.length - this.liveEmittedLength;
    if (
      livePending > 0 &&
      (livePending >= this.config.liveEmitSizeBytes ||
        nowMs - this.lastLiveEmitAtMs >= this.config.liveEmitIntervalMs)
    ) {
      liveUpdates.push(this.emitLive(nowMs));
    }

    // Split oversized backlog into bounded segments...
    while (this.text.length - this.committedLength >= this.config.segmentSizeBytes) {
      segments.push(this.emitSegment(this.config.segmentSizeBytes, false, nowMs));
    }
    // ...then a time-driven segment for any smaller remainder.
    if (
      this.text.length > this.committedLength &&
      nowMs - this.lastSegmentAtMs >= this.config.segmentIntervalMs
    ) {
      segments.push(this.emitSegment(this.text.length - this.committedLength, false, nowMs));
    }

    return liveUpdates.length === 0 && segments.length === 0
      ? EMPTY_EMISSIONS
      : { liveUpdates, segments };
  }

  private emitLive(nowMs: number): LiveAssistantTextUpdate {
    const startOffset = this.liveEmittedLength;
    const delta = this.text.slice(startOffset);
    this.liveEmittedLength = this.text.length;
    this.lastLiveEmitAtMs = nowMs;
    const update: LiveAssistantTextUpdate = {
      threadId: this.identity.threadId,
      turnId: this.identity.turnId,
      messageId: this.identity.messageId,
      revision: this.revision,
      startOffset,
      delta,
      emittedAt: new Date(nowMs).toISOString(),
    };
    this.revision += 1;
    return update;
  }

  private emitSegment(length: number, final: boolean, nowMs: number): LiveAssistantSegment {
    const startOffset = this.committedLength;
    const text = this.text.slice(startOffset, startOffset + length);
    this.committedLength += text.length;
    this.lastSegmentAtMs = nowMs;
    const segment: LiveAssistantSegment = {
      threadId: this.identity.threadId,
      turnId: this.identity.turnId,
      messageId: this.identity.messageId,
      segmentIndex: this.segmentIndex,
      startOffset,
      text,
      final,
    };
    this.segmentIndex += 1;
    return segment;
  }
}

function mergeEmissions(parts: readonly LiveTranscriptEmissions[]): LiveTranscriptEmissions {
  const liveUpdates: LiveAssistantTextUpdate[] = [];
  const segments: LiveAssistantSegment[] = [];
  for (const part of parts) {
    liveUpdates.push(...part.liveUpdates);
    segments.push(...part.segments);
  }
  return { liveUpdates, segments };
}

// Manages accumulators keyed by messageId. The owner calls append() per provider
// delta, poll() on a timer to drain time-based flushes, and finalize() on every
// terminal transition (finalizeAll() on shutdown).
export class LiveTranscriptBuffer {
  private readonly accumulators = new Map<MessageId, LiveMessageAccumulator>();

  constructor(
    private readonly config: LiveTranscriptBufferConfig = DEFAULT_LIVE_TRANSCRIPT_CONFIG,
    private readonly now: () => number = () => Date.now(),
  ) {}

  append(identity: LiveMessageIdentity, delta: string): LiveTranscriptEmissions {
    let accumulator = this.accumulators.get(identity.messageId);
    if (!accumulator) {
      accumulator = new LiveMessageAccumulator(identity, this.config, this.now());
      this.accumulators.set(identity.messageId, accumulator);
    }
    return accumulator.append(delta, this.now());
  }

  // Drain time-based flushes across every active message.
  poll(): LiveTranscriptEmissions {
    const nowMs = this.now();
    const parts: LiveTranscriptEmissions[] = [];
    for (const accumulator of this.accumulators.values()) {
      parts.push(accumulator.poll(nowMs));
    }
    return mergeEmissions(parts);
  }

  // Force the final durable flush for one message and drop it.
  finalize(messageId: MessageId): LiveTranscriptEmissions {
    const accumulator = this.accumulators.get(messageId);
    if (!accumulator) {
      return EMPTY_EMISSIONS;
    }
    const emissions = accumulator.finalize(this.now());
    this.accumulators.delete(messageId);
    return emissions;
  }

  // Flush every active message (session stop / server shutdown).
  finalizeAll(): LiveTranscriptEmissions {
    const nowMs = this.now();
    const parts: LiveTranscriptEmissions[] = [];
    for (const accumulator of this.accumulators.values()) {
      parts.push(accumulator.finalize(nowMs));
    }
    this.accumulators.clear();
    return mergeEmissions(parts);
  }

  snapshot(messageId: MessageId): LiveAssistantSnapshot | null {
    return this.accumulators.get(messageId)?.snapshot() ?? null;
  }

  get activeMessageCount(): number {
    return this.accumulators.size;
  }
}
