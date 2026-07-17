// FILE: ProjectSurfaceHeader.tsx
// Purpose: Keeps Research, the selected thread, and GitHub in one project-scoped header.
// Layer: Shared chat shell navigation

import type { ProjectId, ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { BrainIcon, GitHubIcon, MessageCircleIcon } from "~/lib/icons";
import type { ProjectSurfaceKind } from "~/lib/projectSurface.logic";
import { useLatestProjectStore } from "~/latestProjectStore";
import { useProjectActiveThreadStore } from "~/projectActiveThreadStore";
import { cn } from "~/lib/utils";

function ProjectSurfaceTab(props: {
  active: boolean;
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={props.active ? "page" : undefined}
      disabled={props.disabled}
      onClick={props.onClick}
      className={cn(
        "flex h-9 min-w-0 items-center justify-center gap-2 rounded-[10px] px-3 text-[length:var(--app-font-size-ui-sm,13px)] font-medium transition-[background-color,color,scale] duration-press ease-out active:scale-[0.96] motion-reduce:transition-none motion-reduce:active:scale-100",
        props.active
          ? "bg-selected text-foreground"
          : "text-muted-foreground hover:bg-hover hover:text-foreground",
        props.disabled && "cursor-default opacity-45 active:scale-100",
      )}
    >
      <span className={cn("shrink-0 [&_svg]:size-3.5", props.active && "text-[var(--claude)]")}>
        {props.icon}
      </span>
      <span className="truncate">{props.label}</span>
    </button>
  );
}

export function ProjectSurfaceFrame(props: {
  activeSurface: ProjectSurfaceKind;
  children: ReactNode;
  middleThreadId: ThreadId | null;
  middleThreadTitle: string | null;
  projectId: ProjectId | null;
  projectName: string | null;
  routeThreadId?: ThreadId | null;
}) {
  const navigate = useNavigate();
  const headerVisible = props.projectId !== null && props.projectName !== null;

  const openProjectSurface = (surface: "research" | "github") => {
    if (props.routeThreadId && props.projectId) {
      useProjectActiveThreadStore.getState().setActiveThread(props.projectId, props.routeThreadId);
      useLatestProjectStore.getState().setLatestProjectId(props.projectId);
    }
    void navigate({ to: surface === "research" ? "/research" : "/github" });
  };

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1">
      {headerVisible ? (
        <div className="pointer-events-none absolute inset-x-0 top-2 z-40 flex justify-center px-5">
          <nav
            aria-label={`${props.projectName} project surfaces`}
            className="pointer-events-auto grid h-[42px] w-full max-w-[560px] grid-cols-3 gap-0.5 rounded-[14px] border border-panel-border bg-panel/95 p-0.5 backdrop-blur-lg"
          >
            <ProjectSurfaceTab
              active={props.activeSurface === "research"}
              icon={<BrainIcon />}
              label="Research"
              onClick={() => openProjectSurface("research")}
            />
            <ProjectSurfaceTab
              active={props.activeSurface === "chat"}
              disabled={!props.middleThreadId}
              icon={<MessageCircleIcon />}
              label={props.middleThreadTitle ?? (props.middleThreadId ? "New thread" : "Thread")}
              onClick={() => {
                if (!props.middleThreadId) return;
                void navigate({
                  to: "/$threadId",
                  params: { threadId: props.middleThreadId },
                });
              }}
            />
            <ProjectSurfaceTab
              active={props.activeSurface === "github"}
              icon={<GitHubIcon />}
              label="GitHub"
              onClick={() => openProjectSurface("github")}
            />
          </nav>
        </div>
      ) : null}
      <div className={cn("flex min-h-0 min-w-0 flex-1", headerVisible && "pt-[50px]")}>
        {props.children}
      </div>
    </div>
  );
}
