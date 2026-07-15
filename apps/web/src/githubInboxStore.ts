import { create } from "zustand";

const STORAGE_KEY = "chitauri:github-inbox:v1";

interface PersistedInboxState {
  readonly snoozedUntilByItemId: Record<string, string>;
}

interface GitHubInboxStore extends PersistedInboxState {
  snooze: (itemId: string, until: string) => void;
  unsnooze: (itemId: string) => void;
  pruneExpired: (now?: Date) => void;
}

function readPersistedState(): PersistedInboxState {
  if (typeof window === "undefined") return { snoozedUntilByItemId: {} };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") as {
      snoozedUntilByItemId?: unknown;
    };
    return {
      snoozedUntilByItemId:
        parsed.snoozedUntilByItemId && typeof parsed.snoozedUntilByItemId === "object"
          ? (parsed.snoozedUntilByItemId as Record<string, string>)
          : {},
    };
  } catch {
    return { snoozedUntilByItemId: {} };
  }
}

function persist(state: PersistedInboxState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Inbox snoozing remains usable for this session when storage is unavailable.
  }
}

export const useGitHubInboxStore = create<GitHubInboxStore>((set) => ({
  ...readPersistedState(),
  snooze: (itemId, until) =>
    set((state) => {
      const next = {
        snoozedUntilByItemId: { ...state.snoozedUntilByItemId, [itemId]: until },
      };
      persist(next);
      return next;
    }),
  unsnooze: (itemId) =>
    set((state) => {
      const nextEntries = { ...state.snoozedUntilByItemId };
      delete nextEntries[itemId];
      const next = { snoozedUntilByItemId: nextEntries };
      persist(next);
      return next;
    }),
  pruneExpired: (now = new Date()) =>
    set((state) => {
      const entries = Object.fromEntries(
        Object.entries(state.snoozedUntilByItemId).filter(
          ([, until]) => Date.parse(until) > now.getTime(),
        ),
      );
      if (Object.keys(entries).length === Object.keys(state.snoozedUntilByItemId).length) {
        return state;
      }
      const next = { snoozedUntilByItemId: entries };
      persist(next);
      return next;
    }),
}));
