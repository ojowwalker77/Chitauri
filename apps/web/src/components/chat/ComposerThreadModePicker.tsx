import { CentralIcon } from "~/lib/central-icons";
import { ChevronDownIcon } from "~/lib/icons";
import {
  COMPOSER_PICKER_TRIGGER_TEXT_CLASS_NAME,
  ORCHESTRATOR_MODE_ACCENT_CLASS_NAME,
} from "./composerPickerStyles";
import type { ComposerThreadMode } from "~/lib/orchestratorComposerMode";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from "../ui/menu";
import { ComposerPickerMenuPopup } from "./ComposerPickerMenuPopup";

const MODE_COPY = {
  orchestrator: {
    label: "Orchestrator",
    description: "Coordinates the work and delegates focused tasks to specialist agents.",
    icon: "agent-network",
  },
  "single-agent": {
    label: "Single Agent",
    description: "One agent works directly in this thread from start to finish.",
    icon: "agent",
  },
} as const satisfies Record<
  ComposerThreadMode,
  { label: string; description: string; icon: string }
>;

export function ComposerThreadModePicker(props: {
  value: ComposerThreadMode;
  onValueChange: (mode: ComposerThreadMode) => void;
  hideLabel?: boolean;
  orchestratorAvailable?: boolean;
}) {
  const activeMode = MODE_COPY[props.value];
  const orchestratorAvailable = props.orchestratorAvailable !== false;

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            size="sm"
            variant="chrome"
            className={cn(
              "min-w-0 shrink-0 justify-start gap-1.5 whitespace-nowrap px-2 [&_svg]:mx-0 sm:px-2.5",
              COMPOSER_PICKER_TRIGGER_TEXT_CLASS_NAME,
              props.value === "orchestrator" && ORCHESTRATOR_MODE_ACCENT_CLASS_NAME,
            )}
            title={`${activeMode.label} thread — click to change thread mode`}
            data-testid="composer-thread-mode-trigger"
          />
        }
      >
        <span className="inline-flex items-center gap-1.5">
          <CentralIcon name={activeMode.icon} className="size-3.5 shrink-0" />
          <span className={cn("truncate", props.hideLabel ? "sr-only" : "@max-[480px]:sr-only")}>
            {activeMode.label}
          </span>
          <ChevronDownIcon
            className={cn(
              "size-3 shrink-0 opacity-70",
              props.hideLabel ? "hidden" : "@max-[480px]:hidden",
            )}
          />
        </span>
      </MenuTrigger>
      <ComposerPickerMenuPopup align="start" side="top" className="w-[19rem] max-w-[92vw]">
        <MenuGroup>
          <MenuGroupLabel>Thread mode</MenuGroupLabel>
          <MenuRadioGroup
            value={props.value}
            onValueChange={(value) => {
              if (
                !value ||
                (value !== "orchestrator" && value !== "single-agent") ||
                value === props.value
              ) {
                return;
              }
              props.onValueChange(value);
            }}
          >
            {(Object.keys(MODE_COPY) as ComposerThreadMode[]).map((mode) => {
              const copy = MODE_COPY[mode];
              const disabled = mode === "orchestrator" && !orchestratorAvailable;
              return (
                <MenuRadioItem
                  key={mode}
                  value={mode}
                  disabled={disabled}
                  className={cn(
                    "items-start py-2.5",
                    mode === "orchestrator" &&
                      "data-checked:text-[var(--orchestrator-mode-accent)]",
                  )}
                  data-testid={`composer-thread-mode-${mode}`}
                >
                  <CentralIcon name={copy.icon} className="mt-0.5 size-4 shrink-0" />
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block font-medium leading-4">{copy.label}</span>
                    <span className="mt-0.5 block text-pretty text-[10px] leading-4 text-muted-foreground">
                      {disabled
                        ? "Add an allowed seat model in Settings → Orchestrator first."
                        : copy.description}
                    </span>
                  </span>
                </MenuRadioItem>
              );
            })}
          </MenuRadioGroup>
        </MenuGroup>
      </ComposerPickerMenuPopup>
    </Menu>
  );
}
