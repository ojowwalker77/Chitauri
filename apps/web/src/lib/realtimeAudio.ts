import type { ProviderRealtimeAudioChunk } from "@t3tools/contracts";

export interface DecodedPcm16Audio {
  readonly sampleRate: number;
  readonly channels: ReadonlyArray<Float32Array<ArrayBuffer>>;
}

const PCM16_SCALE = 32_768;
const INITIAL_PLAYBACK_BUFFER_SECONDS = 0.03;

export function decodePcm16AudioChunk(audio: ProviderRealtimeAudioChunk): DecodedPcm16Audio | null {
  let encoded: string;
  try {
    encoded = atob(audio.data);
  } catch {
    return null;
  }

  const bytesPerFrame = audio.numChannels * Int16Array.BYTES_PER_ELEMENT;
  if (bytesPerFrame <= 0) return null;
  const availableFrames = Math.floor(encoded.length / bytesPerFrame);
  const frameCount = Math.min(audio.samplesPerChannel ?? availableFrames, availableFrames);
  if (frameCount <= 0) return null;

  const bytes = new Uint8Array(encoded.length);
  for (let index = 0; index < encoded.length; index += 1) {
    bytes[index] = encoded.charCodeAt(index);
  }
  const samples = new DataView(bytes.buffer);
  const channels = Array.from(
    { length: audio.numChannels },
    () => new Float32Array(new ArrayBuffer(frameCount * Float32Array.BYTES_PER_ELEMENT)),
  );

  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < audio.numChannels; channel += 1) {
      const byteOffset = (frame * audio.numChannels + channel) * Int16Array.BYTES_PER_ELEMENT;
      channels[channel]![frame] = samples.getInt16(byteOffset, true) / PCM16_SCALE;
    }
  }

  return {
    sampleRate: audio.sampleRate,
    channels,
  };
}

export class RealtimePcmPlayer {
  readonly #context: AudioContext;
  readonly #destination: AudioNode;
  readonly #sources = new Set<AudioBufferSourceNode>();
  #nextPlaybackTime = 0;

  constructor(context: AudioContext, destination: AudioNode) {
    this.#context = context;
    this.#destination = destination;
  }

  enqueue(audio: ProviderRealtimeAudioChunk): boolean {
    const decoded = decodePcm16AudioChunk(audio);
    if (!decoded) return false;

    const frameCount = decoded.channels[0]?.length ?? 0;
    if (frameCount === 0) return false;

    const buffer = this.#context.createBuffer(
      decoded.channels.length,
      frameCount,
      decoded.sampleRate,
    );
    for (const [channel, samples] of decoded.channels.entries()) {
      buffer.copyToChannel(samples, channel);
    }

    const source = this.#context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.#destination);
    source.onended = () => {
      source.disconnect();
      this.#sources.delete(source);
    };
    this.#sources.add(source);

    const startAt = Math.max(
      this.#nextPlaybackTime,
      this.#context.currentTime + INITIAL_PLAYBACK_BUFFER_SECONDS,
    );
    source.start(startAt);
    this.#nextPlaybackTime = startAt + buffer.duration;
    if (this.#context.state === "suspended") {
      void this.#context.resume();
    }
    return true;
  }

  stop(): void {
    for (const source of this.#sources) {
      try {
        source.stop();
      } catch {
        // The source may already have ended between iteration and stop.
      }
      source.disconnect();
    }
    this.#sources.clear();
    this.#nextPlaybackTime = 0;
  }
}
