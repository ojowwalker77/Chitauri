// FILE: RepositoryProjectFilter.tsx
// Purpose: Quiet repository scope picker shared by Research and GitHub route headers.
// Layer: Route navigation UI

import { PickerSelectPopup } from "~/components/chat/ComposerPickerMenuPopup";
import { Select, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { ALL_PROJECTS_FILTER, projectFilterValue } from "~/lib/projectFilter";
import type { Project } from "~/types";

export function RepositoryProjectFilter(props: {
  ariaLabel: string;
  projects: readonly Project[];
  selectedProject: Project | null;
  onValueChange: (value: string) => void;
  align?: "start" | "end";
}) {
  return (
    <Select value={projectFilterValue(props.selectedProject)} onValueChange={props.onValueChange}>
      <SelectTrigger
        size="sm"
        variant="ghost"
        aria-label={props.ariaLabel}
        className="w-44 [-webkit-app-region:no-drag] max-sm:w-36"
      >
        <SelectValue>{props.selectedProject?.name ?? "All repositories"}</SelectValue>
      </SelectTrigger>
      <PickerSelectPopup align={props.align ?? "start"} className="min-w-56">
        <SelectItem hideIndicator value={ALL_PROJECTS_FILTER}>
          All repositories
        </SelectItem>
        {props.projects.map((project) => (
          <SelectItem hideIndicator key={project.id} value={project.id}>
            {project.name}
          </SelectItem>
        ))}
      </PickerSelectPopup>
    </Select>
  );
}
