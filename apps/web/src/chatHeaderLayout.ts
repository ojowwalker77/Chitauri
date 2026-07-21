// FILE: chatHeaderLayout.ts
// Purpose: Keeps chat header action ordering stable across settings and the header itself.
// Layer: Web settings utility
// Exports: default order, control labels, normalization, and order comparison helpers.

export type ChatHeaderControlId =
  | "usage"
  | "handoff"
  | "projectScripts"
  | "environment"
  | "openIn"
  | "gitActions";

export const DEFAULT_CHAT_HEADER_CONTROL_ORDER = [
  "usage",
  "handoff",
  "projectScripts",
  "environment",
  "openIn",
  "gitActions",
] as const satisfies readonly ChatHeaderControlId[];

export const CHAT_HEADER_CONTROL_LABELS: Record<
  ChatHeaderControlId,
  { title: string; description: string }
> = {
  usage: {
    title: "Context usage",
    description: "The percentage chip showing remaining context.",
  },
  handoff: {
    title: "Hand off",
    description: "Hand the thread off to another provider.",
  },
  projectScripts: {
    title: "Worker actions",
    description: "Run and manage repository scripts for this Worker.",
  },
  environment: {
    title: "Environment",
    description: "Opens the Environment side panel.",
  },
  openIn: {
    title: "Open in editor",
    description: "Open the Worker's repository in your editor.",
  },
  gitActions: {
    title: "Git actions",
    description: "Commit, push, and pull request shortcuts.",
  },
};

const CHAT_HEADER_CONTROL_ID_SET: ReadonlySet<ChatHeaderControlId> = new Set(
  DEFAULT_CHAT_HEADER_CONTROL_ORDER,
);

export function isChatHeaderControlId(value: string): value is ChatHeaderControlId {
  return CHAT_HEADER_CONTROL_ID_SET.has(value as ChatHeaderControlId);
}

export function normalizeHiddenChatHeaderControls(
  hidden: ReadonlyArray<string>,
): ChatHeaderControlId[] {
  const seen = new Set<ChatHeaderControlId>();
  const result: ChatHeaderControlId[] = [];
  for (const candidate of hidden) {
    if (isChatHeaderControlId(candidate) && !seen.has(candidate)) {
      seen.add(candidate);
      result.push(candidate);
    }
  }
  return result;
}

export function normalizeChatHeaderControlOrder(
  order: ReadonlyArray<string>,
): ChatHeaderControlId[] {
  const seen = new Set<ChatHeaderControlId>();
  const result: ChatHeaderControlId[] = [];
  for (const candidate of order) {
    if (isChatHeaderControlId(candidate) && !seen.has(candidate)) {
      seen.add(candidate);
      result.push(candidate);
    }
  }
  // Append ids missing from the persisted order so a control shipped in a later release can
  // never vanish from a header whose order was saved before that control existed.
  for (const control of DEFAULT_CHAT_HEADER_CONTROL_ORDER) {
    if (!seen.has(control)) {
      result.push(control);
    }
  }
  return result;
}

export function sameChatHeaderControlOrder(
  left: ReadonlyArray<ChatHeaderControlId>,
  right: ReadonlyArray<ChatHeaderControlId>,
): boolean {
  return left.length === right.length && left.every((control, index) => control === right[index]);
}

export function compareChatHeaderControlsByOrder(
  order: ReadonlyArray<ChatHeaderControlId>,
  left: ChatHeaderControlId,
  right: ChatHeaderControlId,
): number {
  const leftIndex = order.indexOf(left);
  const rightIndex = order.indexOf(right);
  const normalizedLeftIndex =
    leftIndex >= 0 ? leftIndex : DEFAULT_CHAT_HEADER_CONTROL_ORDER.indexOf(left) + order.length;
  const normalizedRightIndex =
    rightIndex >= 0 ? rightIndex : DEFAULT_CHAT_HEADER_CONTROL_ORDER.indexOf(right) + order.length;
  return normalizedLeftIndex - normalizedRightIndex;
}
