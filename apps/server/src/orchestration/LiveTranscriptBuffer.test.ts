import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  LiveAssistantSegment,
  LiveAssistantTextUpdate,
  MessageId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";

import {
  DEFAULT_LIVE_TRANSCRIPT_CONFIG,
  LiveTranscriptBuffer,
  type LiveMessageIdentity,
  type LiveTranscriptBufferConfig,
  type LiveTranscriptEmissions,
} from "./LiveTranscriptBuffer";

const IDENTITY: LiveMessageIdentity = {
  threadId: ThreadId.makeUnsafe("thread-1"),
  turnId: TurnId.makeUnsafe("turn-1"),
  messageId: MessageId.makeUnsafe("message-1"),
};

function makeClock(startMs = 1_000): { now: () => number; advance: (ms: number) => void } {
  let current = startMs;
  return { now: () => current, advance: (ms: number) => (current += ms) };
}

function collect(target: {
  liveUpdates: LiveAssistantTextUpdate[];
  segments: LiveAssistantSegment[];
}): (emissions: LiveTranscriptEmissions) => void {
  return (emissions) => {
    target.liveUpdates.push(...emissions.liveUpdates);
    target.segments.push(...emissions.segments);
  };
}

function assertContiguousSegments(segments: readonly LiveAssistantSegment[]): void {
  let expectedIndex = 0;
  let expectedOffset = 0;
  for (const segment of segments) {
    expect(segment.segmentIndex).toBe(expectedIndex);
    expect(segment.startOffset).toBe(expectedOffset);
    expectedIndex += 1;
    expectedOffset += segment.text.length;
  }
}

describe("LiveTranscriptBuffer", () => {
  it("reconstructs exact final text from 10,000 tiny deltas with a bounded segment count", () => {
    const clock = makeClock();
    const buffer = new LiveTranscriptBuffer(DEFAULT_LIVE_TRANSCRIPT_CONFIG, clock.now);
    const all = {
      liveUpdates: [] as LiveAssistantTextUpdate[],
      segments: [] as LiveAssistantSegment[],
    };
    const sink = collect(all);

    let expected = "";
    for (let i = 0; i < 10_000; i += 1) {
      const char = String.fromCharCode(97 + (i % 26));
      expected += char;
      sink(buffer.append(IDENTITY, char));
      clock.advance(1); // 1ms per delta => ~10s of streaming
    }
    sink(buffer.finalize(IDENTITY.messageId));

    // Byte-for-byte identical final text, assembled from durable segments.
    expect(all.segments.map((segment) => segment.text).join("")).toBe(expected);
    // Bounded: tens of segments, not one per provider chunk.
    expect(all.segments.length).toBeLessThan(100);
    // Stable, contiguous identity for idempotent replay.
    assertContiguousSegments(all.segments);
    // Live updates also cover the text contiguously and monotonically.
    expect(all.liveUpdates.map((update) => update.delta).join("")).toBe(expected);
    for (let i = 1; i < all.liveUpdates.length; i += 1) {
      expect(all.liveUpdates[i]!.revision).toBeGreaterThan(all.liveUpdates[i - 1]!.revision);
      expect(all.liveUpdates[i]!.startOffset).toBeGreaterThanOrEqual(
        all.liveUpdates[i - 1]!.startOffset,
      );
    }
  });

  it("reconstructs exact text under pure size-based flushing (no clock advance)", () => {
    const clock = makeClock();
    const buffer = new LiveTranscriptBuffer(DEFAULT_LIVE_TRANSCRIPT_CONFIG, clock.now);
    const all = {
      liveUpdates: [] as LiveAssistantTextUpdate[],
      segments: [] as LiveAssistantSegment[],
    };
    const sink = collect(all);

    const expected = "x".repeat(10_000);
    // All deltas at the same instant: only the size threshold drives segments.
    for (const char of expected) sink(buffer.append(IDENTITY, char));
    sink(buffer.finalize(IDENTITY.messageId));

    expect(all.segments.map((segment) => segment.text).join("")).toBe(expected);
    for (const segment of all.segments) {
      expect(segment.text.length).toBeLessThanOrEqual(
        DEFAULT_LIVE_TRANSCRIPT_CONFIG.segmentSizeBytes,
      );
    }
    assertContiguousSegments(all.segments);
  });

  it("always emits exactly one final segment on finalize, even when empty", () => {
    const clock = makeClock();
    const buffer = new LiveTranscriptBuffer(DEFAULT_LIVE_TRANSCRIPT_CONFIG, clock.now);
    const emissions = buffer.finalize(IDENTITY.messageId);
    // finalize on an unknown message is a no-op...
    expect(emissions.segments).toHaveLength(0);

    // ...but a started-then-finalized empty message still closes durably.
    buffer.append(IDENTITY, "");
    const closed = buffer.finalize(IDENTITY.messageId);
    expect(closed.segments).toHaveLength(1);
    expect(closed.segments[0]!.final).toBe(true);
    expect(closed.segments[0]!.text).toBe("");
  });

  it("marks only the last segment final and preserves the tail", () => {
    const clock = makeClock();
    const buffer = new LiveTranscriptBuffer(DEFAULT_LIVE_TRANSCRIPT_CONFIG, clock.now);
    const all = {
      liveUpdates: [] as LiveAssistantTextUpdate[],
      segments: [] as LiveAssistantSegment[],
    };
    const sink = collect(all);

    sink(buffer.append(IDENTITY, "hello world"));
    sink(buffer.finalize(IDENTITY.messageId));

    expect(all.segments.at(-1)!.final).toBe(true);
    expect(all.segments.filter((segment) => segment.final)).toHaveLength(1);
    expect(all.segments.map((segment) => segment.text).join("")).toBe("hello world");
  });

  it("coalesces many small deltas within one interval into few live updates", () => {
    const clock = makeClock();
    const config: LiveTranscriptBufferConfig = {
      liveEmitIntervalMs: 100,
      liveEmitSizeBytes: 1_000,
      segmentIntervalMs: 1_000,
      segmentSizeBytes: 10_000,
    };
    const buffer = new LiveTranscriptBuffer(config, clock.now);
    const all = {
      liveUpdates: [] as LiveAssistantTextUpdate[],
      segments: [] as LiveAssistantSegment[],
    };
    const sink = collect(all);

    // 50 one-char deltas over 50ms: under both the time and size thresholds, so no
    // live update fires until finalize.
    for (let i = 0; i < 50; i += 1) {
      sink(buffer.append(IDENTITY, "a"));
      clock.advance(1);
    }
    expect(all.liveUpdates).toHaveLength(0);
    sink(buffer.finalize(IDENTITY.messageId));
    expect(all.liveUpdates).toHaveLength(1);
    expect(all.liveUpdates[0]!.delta).toBe("a".repeat(50));
  });

  it("emits a live update immediately once the size threshold is crossed", () => {
    const clock = makeClock();
    const config: LiveTranscriptBufferConfig = {
      liveEmitIntervalMs: 10_000,
      liveEmitSizeBytes: 8,
      segmentIntervalMs: 10_000,
      segmentSizeBytes: 10_000,
    };
    const buffer = new LiveTranscriptBuffer(config, clock.now);
    // No time passes, but 8 chars crosses the size threshold.
    const emissions = buffer.append(IDENTITY, "12345678");
    expect(emissions.liveUpdates).toHaveLength(1);
    expect(emissions.liveUpdates[0]!.delta).toBe("12345678");
    expect(emissions.liveUpdates[0]!.startOffset).toBe(0);
  });

  it("splits an oversized delta into bounded segments", () => {
    const clock = makeClock();
    const config: LiveTranscriptBufferConfig = {
      liveEmitIntervalMs: 100,
      liveEmitSizeBytes: 1_000,
      segmentIntervalMs: 100,
      segmentSizeBytes: 20,
    };
    const buffer = new LiveTranscriptBuffer(config, clock.now);
    const emissions = buffer.append(IDENTITY, "y".repeat(105));

    // 105 chars / 20 => 5 full bounded segments emitted immediately by the size loop.
    expect(emissions.segments.length).toBeGreaterThanOrEqual(5);
    for (const segment of emissions.segments) {
      expect(segment.text.length).toBeLessThanOrEqual(20);
    }
    const finalized = buffer.finalize(IDENTITY.messageId);
    const allText = [...emissions.segments, ...finalized.segments]
      .map((segment) => segment.text)
      .join("");
    expect(allText).toBe("y".repeat(105));
  });

  it("is idempotent on repeated finalize and reports active message count", () => {
    const clock = makeClock();
    const buffer = new LiveTranscriptBuffer(DEFAULT_LIVE_TRANSCRIPT_CONFIG, clock.now);
    buffer.append(IDENTITY, "content");
    expect(buffer.activeMessageCount).toBe(1);

    const first = buffer.finalize(IDENTITY.messageId);
    expect(first.segments.length).toBeGreaterThan(0);
    expect(buffer.activeMessageCount).toBe(0);

    const second = buffer.finalize(IDENTITY.messageId);
    expect(second.segments).toHaveLength(0);
  });

  it("finalizeAll flushes every active message and clears the buffer", () => {
    const clock = makeClock();
    const buffer = new LiveTranscriptBuffer(DEFAULT_LIVE_TRANSCRIPT_CONFIG, clock.now);
    const second: LiveMessageIdentity = {
      ...IDENTITY,
      messageId: MessageId.makeUnsafe("message-2"),
    };
    buffer.append(IDENTITY, "one");
    buffer.append(second, "two");

    const emissions = buffer.finalizeAll();
    expect(buffer.activeMessageCount).toBe(0);
    const byMessage = new Map<string, string>();
    for (const segment of emissions.segments) {
      byMessage.set(segment.messageId, (byMessage.get(segment.messageId) ?? "") + segment.text);
    }
    expect(byMessage.get("message-1")).toBe("one");
    expect(byMessage.get("message-2")).toBe("two");
  });

  it("exposes a reconnect snapshot with committed length and completion", () => {
    const clock = makeClock();
    const config: LiveTranscriptBufferConfig = {
      liveEmitIntervalMs: 100,
      liveEmitSizeBytes: 1_000,
      segmentIntervalMs: 5,
      segmentSizeBytes: 1_000,
    };
    const buffer = new LiveTranscriptBuffer(config, clock.now);
    buffer.append(IDENTITY, "abc");
    clock.advance(10);
    buffer.poll(); // time-driven segment commits "abc"
    buffer.append(IDENTITY, "def"); // not yet committed

    const snapshot = buffer.snapshot(IDENTITY.messageId);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.text).toBe("abcdef");
    expect(snapshot!.committedLength).toBe(3);
    expect(snapshot!.complete).toBe(false);
    expect(buffer.snapshot(MessageId.makeUnsafe("missing"))).toBeNull();
  });

  it("produces schema-valid live updates and segments", () => {
    const clock = makeClock();
    const buffer = new LiveTranscriptBuffer(
      { liveEmitIntervalMs: 1, liveEmitSizeBytes: 1, segmentIntervalMs: 1, segmentSizeBytes: 4 },
      clock.now,
    );
    const all = {
      liveUpdates: [] as LiveAssistantTextUpdate[],
      segments: [] as LiveAssistantSegment[],
    };
    const sink = collect(all);
    clock.advance(5);
    sink(buffer.append(IDENTITY, "hello there"));
    sink(buffer.finalize(IDENTITY.messageId));

    for (const update of all.liveUpdates) {
      expect(() => Schema.decodeUnknownSync(LiveAssistantTextUpdate)(update)).not.toThrow();
    }
    for (const segment of all.segments) {
      expect(() => Schema.decodeUnknownSync(LiveAssistantSegment)(segment)).not.toThrow();
    }
  });
});
