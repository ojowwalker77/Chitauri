import { ThinkingOrb, type OrbState } from "thinking-orbs";
import { useEffect } from "react";

import type { CodexVoiceStatus } from "../../hooks/useCodexVoiceSession";
import { MicrophoneIcon, StopIcon, XIcon } from "../../lib/icons";
import type { VoiceOrbState } from "../../lib/voiceFocus";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { IconButton } from "../ui/icon-button";

interface VoiceFocusSurfaceProps {
  readonly status: CodexVoiceStatus;
  readonly error: string | null;
  readonly transcript: {
    readonly user: string;
    readonly assistant: string;
  };
  readonly orbState: VoiceOrbState;
  readonly muted: boolean;
  readonly onToggleMute: () => void;
  readonly onEnd: () => void;
  readonly onRetry: () => void;
  readonly onDismissError: () => void;
}

const STATUS_LABEL: Record<CodexVoiceStatus, string> = {
  idle: "Live voice",
  connecting: "Connecting live voice…",
  listening: "Live voice",
  speaking: "Live voice",
  muted: "Microphone muted",
  ending: "Ending voice session…",
  error: "Live voice unavailable",
};

const ORB_RENDER_STATE: Record<VoiceOrbState, OrbState> = {
  // Thinking Orbs names the visual used by its "Thinking…" showcase
  // `composing`; keep TeaCode's product state named after what the user sees.
  thinking: "composing",
  solving: "solving",
  searching: "searching",
};

export function VoiceFocusSurface({
  status,
  error,
  transcript,
  orbState,
  muted,
  onToggleMute,
  onEnd,
  onRetry,
  onDismissError,
}: VoiceFocusSurfaceProps) {
  const isError = status === "error";
  const isTransitioning = status === "connecting" || status === "ending";

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || isTransitioning) return;
      event.preventDefault();
      if (isError) {
        onDismissError();
      } else {
        onEnd();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isError, isTransitioning, onDismissError, onEnd]);

  return (
    <section
      aria-label="Live voice"
      className="@container flex min-h-0 flex-1 flex-col overflow-hidden bg-background pb-[var(--chat-composer-inset)] text-foreground"
    >
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-8 overflow-y-auto px-6 py-8 [--voice-orb:72px] @[560px]:[--voice-orb:96px] @[880px]:[--voice-orb:112px]">
        <ThinkingOrb
          state={ORB_RENDER_STATE[orbState]}
          size={64}
          style={{ width: "var(--voice-orb)", height: "var(--voice-orb)" }}
          aria-label={orbState}
        />

        <span className="text-[13px] tracking-[-0.15px] text-faint">{STATUS_LABEL[status]}</span>

        <div className="w-full max-w-[42rem] text-center" aria-live="polite">
          <p
            className={cn(
              "min-h-8 text-balance text-2xl leading-snug tracking-[-0.15px]",
              isError ? "text-destructive" : "text-foreground",
            )}
          >
            {error ??
              transcript.assistant ??
              (isTransitioning ? STATUS_LABEL[status] : "Speak naturally. TeaCode is listening.")}
          </p>
          {!isError && transcript.user ? (
            <p className="mt-4 text-balance text-sm leading-relaxed text-muted-foreground">
              You: {transcript.user}
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-3">
          {isError ? (
            <>
              <Button type="button" variant="outline" size="sm" onClick={onDismissError}>
                Close
              </Button>
              <Button type="button" size="sm" onClick={onRetry}>
                Try again
              </Button>
            </>
          ) : (
            <>
              <IconButton
                type="button"
                variant={muted ? "outline" : "ghost"}
                size="icon-sm"
                label={muted ? "Unmute microphone" : "Mute microphone"}
                title={muted ? "Unmute microphone" : "Mute microphone"}
                onClick={onToggleMute}
                disabled={isTransitioning}
              >
                <MicrophoneIcon className={cn("size-4", muted && "opacity-45")} />
              </IconButton>
              <IconButton
                type="button"
                variant="prominent"
                size="icon-sm"
                label="End live voice"
                title="End live voice"
                onClick={onEnd}
                disabled={status === "ending"}
              >
                {status === "ending" ? (
                  <XIcon className="size-4" />
                ) : (
                  <StopIcon className="size-3.5" />
                )}
              </IconButton>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
