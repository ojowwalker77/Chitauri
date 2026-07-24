import type { ProviderRealtimeEvent, ProviderRealtimeVoice, ThreadId } from "@t3tools/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import { ensureNativeApi } from "../nativeApi";
import { RealtimePcmPlayer } from "../lib/realtimeAudio";

export type CodexVoiceStatus =
  | "idle"
  | "connecting"
  | "listening"
  | "speaking"
  | "muted"
  | "ending"
  | "error";

interface VoiceTranscript {
  readonly user: string;
  readonly assistant: string;
}

function isAssistantRole(role: string): boolean {
  const normalized = role.toLowerCase();
  return normalized === "assistant" || normalized === "agent";
}

export function useCodexVoiceSession(threadId: ThreadId | null) {
  const [status, setStatus] = useState<CodexVoiceStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<VoiceTranscript>({
    user: "",
    assistant: "",
  });

  const statusRef = useRef<CodexVoiceStatus>("idle");
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const remoteAudioElementRef = useRef<HTMLAudioElement | null>(null);
  const remoteTrackPlaybackReadyRef = useRef(false);
  const pcmPlayerRef = useRef<RealtimePcmPlayer | null>(null);

  const updateStatus = useCallback((next: CodexVoiceStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const releaseMedia = useCallback(() => {
    dataChannelRef.current?.close();
    dataChannelRef.current = null;
    peerRef.current?.close();
    peerRef.current = null;
    for (const track of localStreamRef.current?.getTracks() ?? []) {
      track.stop();
    }
    localStreamRef.current = null;
    const remoteAudioElement = remoteAudioElementRef.current;
    remoteAudioElementRef.current = null;
    remoteTrackPlaybackReadyRef.current = false;
    if (remoteAudioElement) {
      remoteAudioElement.pause();
      remoteAudioElement.srcObject = null;
      remoteAudioElement.remove();
    }
    pcmPlayerRef.current?.stop();
    pcmPlayerRef.current = null;
    const audioContext = audioContextRef.current;
    audioContextRef.current = null;
    if (audioContext && audioContext.state !== "closed") {
      void audioContext.close();
    }
  }, []);

  const finishLocally = useCallback(
    (next: "idle" | "error", message?: string) => {
      releaseMedia();
      updateStatus(next);
      setError(message ?? null);
    },
    [releaseMedia, updateStatus],
  );

  useEffect(() => {
    if (!threadId) return;
    const api = ensureNativeApi();
    const unsubscribe = api.provider.onRealtimeEvent((event: ProviderRealtimeEvent) => {
      if (event.threadId !== threadId) return;
      switch (event.type) {
        case "started":
          if (statusRef.current === "connecting") updateStatus("listening");
          return;
        case "sdp":
          void peerRef.current
            ?.setRemoteDescription({ type: "answer", sdp: event.sdp })
            .then(() => updateStatus("listening"))
            .catch((cause: unknown) => {
              finishLocally(
                "error",
                cause instanceof Error ? cause.message : "Could not connect live voice audio.",
              );
            });
          return;
        case "transcript.delta":
          if (statusRef.current !== "muted") {
            updateStatus(isAssistantRole(event.role) ? "speaking" : "listening");
          }
          setTranscript((current) =>
            isAssistantRole(event.role)
              ? { ...current, assistant: `${current.assistant}${event.delta}` }
              : { ...current, user: `${current.user}${event.delta}` },
          );
          return;
        case "transcript.done":
          setTranscript((current) =>
            isAssistantRole(event.role)
              ? { ...current, assistant: event.text }
              : { ...current, user: event.text },
          );
          return;
        case "audio.delta":
          if (!remoteTrackPlaybackReadyRef.current && pcmPlayerRef.current?.enqueue(event.audio)) {
            updateStatus("speaking");
          }
          return;
        case "error":
          finishLocally("error", event.message);
          return;
        case "closed":
          // App-server emits `closed` immediately after a realtime error. Keep
          // the specific error visible instead of letting the terminal event
          // erase it and drop the user back into the normal transcript.
          if (statusRef.current === "error") return;
          finishLocally("idle");
          return;
      }
    });

    return () => {
      unsubscribe();
      if (statusRef.current !== "idle") {
        void api.provider.stopRealtime({ threadId }).catch(() => undefined);
      }
      releaseMedia();
      statusRef.current = "idle";
    };
  }, [finishLocally, releaseMedia, threadId, updateStatus]);

  const start = useCallback(
    async (voice?: ProviderRealtimeVoice) => {
      if (!threadId || (statusRef.current !== "idle" && statusRef.current !== "error")) {
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === "undefined") {
        finishLocally("error", "Live voice is not supported by this browser.");
        return;
      }

      updateStatus("connecting");
      setError(null);
      setTranscript({ user: "", assistant: "" });

      try {
        const remoteAudioElement = new Audio();
        remoteAudioElement.autoplay = true;
        remoteAudioElement.volume = 1;
        remoteAudioElement.setAttribute("aria-hidden", "true");
        remoteAudioElement.setAttribute("playsinline", "");
        remoteAudioElement.style.display = "none";
        document.body.append(remoteAudioElement);
        remoteAudioElementRef.current = remoteAudioElement;

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        localStreamRef.current = stream;

        const peer = new RTCPeerConnection();
        peerRef.current = peer;
        for (const track of stream.getAudioTracks()) {
          peer.addTrack(track, stream);
        }
        dataChannelRef.current = peer.createDataChannel("oai-events");

        const AudioContextConstructor =
          window.AudioContext ??
          (
            window as typeof window & {
              webkitAudioContext?: typeof AudioContext;
            }
          ).webkitAudioContext;
        if (!AudioContextConstructor) {
          throw new Error("Live voice audio is not supported by this browser.");
        }
        const audioContext = new AudioContextConstructor();
        audioContextRef.current = audioContext;
        await audioContext.resume();

        pcmPlayerRef.current = new RealtimePcmPlayer(audioContext, audioContext.destination);

        peer.ontrack = (event) => {
          const remoteStream = event.streams[0] ?? new MediaStream([event.track]);
          remoteAudioElement.srcObject = remoteStream;
          void remoteAudioElement
            .play()
            .then(() => {
              remoteTrackPlaybackReadyRef.current = true;
            })
            .catch((cause: unknown) => {
              finishLocally(
                "error",
                cause instanceof Error
                  ? `Could not play live voice audio: ${cause.message}`
                  : "Could not play live voice audio.",
              );
            });
        };

        peer.onconnectionstatechange = () => {
          if (peer.connectionState === "failed" || peer.connectionState === "disconnected") {
            finishLocally("error", "The live voice connection was lost.");
          }
        };

        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        if (!offer.sdp) {
          throw new Error("The browser did not create a live voice offer.");
        }
        await ensureNativeApi().provider.startRealtime({
          threadId,
          sdp: offer.sdp,
          ...(voice ? { voice } : {}),
        });
      } catch (cause) {
        finishLocally(
          "error",
          cause instanceof Error ? cause.message : "Could not start live voice.",
        );
      }
    },
    [finishLocally, threadId, updateStatus],
  );

  const stop = useCallback(async () => {
    if (!threadId || statusRef.current === "idle" || statusRef.current === "ending") return;
    updateStatus("ending");
    try {
      await ensureNativeApi().provider.stopRealtime({ threadId });
      finishLocally("idle");
    } catch (cause) {
      finishLocally("error", cause instanceof Error ? cause.message : "Could not stop live voice.");
    }
  }, [finishLocally, threadId, updateStatus]);

  const toggleMute = useCallback(() => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    updateStatus(track.enabled ? "listening" : "muted");
  }, [updateStatus]);

  return {
    status,
    error,
    transcript,
    isActive: status !== "idle",
    isMuted: status === "muted",
    start,
    stop,
    toggleMute,
    dismissError: () => finishLocally("idle"),
  };
}
