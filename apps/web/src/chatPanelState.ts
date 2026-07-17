import type { TurnId } from "@t3tools/contracts";

export interface ChatPanelState {
  panel: "diff" | null;
  diffTurnId: TurnId | null;
  diffFilePath: string | null;
  hasOpenedPanel: boolean;
  lastOpenPanel: "diff";
}
