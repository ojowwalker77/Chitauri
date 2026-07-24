import { describe, expect, it } from "vitest";

import { decodePcm16AudioChunk } from "./realtimeAudio";

function pcm16Base64(samples: ReadonlyArray<number>): string {
  const bytes = new Uint8Array(samples.length * Int16Array.BYTES_PER_ELEMENT);
  const view = new DataView(bytes.buffer);
  for (const [index, sample] of samples.entries()) {
    view.setInt16(index * Int16Array.BYTES_PER_ELEMENT, sample, true);
  }
  return Buffer.from(bytes).toString("base64");
}

describe("decodePcm16AudioChunk", () => {
  it("decodes interleaved little-endian PCM16 channels", () => {
    const decoded = decodePcm16AudioChunk({
      data: pcm16Base64([0, 16_384, -32_768, 32_767]),
      sampleRate: 24_000,
      numChannels: 2,
      samplesPerChannel: 2,
    });

    expect(decoded?.sampleRate).toBe(24_000);
    expect(Array.from(decoded?.channels[0] ?? [])).toEqual([0, -1]);
    expect(Array.from(decoded?.channels[1] ?? [])).toEqual([0.5, 32_767 / 32_768]);
  });

  it("rejects malformed base64 and empty frames", () => {
    expect(
      decodePcm16AudioChunk({
        data: "not base64",
        sampleRate: 24_000,
        numChannels: 1,
      }),
    ).toBeNull();
    expect(
      decodePcm16AudioChunk({
        data: "",
        sampleRate: 24_000,
        numChannels: 1,
      }),
    ).toBeNull();
  });
});
