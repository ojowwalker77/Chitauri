import type {
  OrchestrationCommand,
  OrchestrationProject,
  OrchestrationReadModel,
  OrchestrationTask,
  OrchestrationThread,
  ProjectKind,
  ProjectId,
  TaskId,
  ThreadId,
} from "@t3tools/contracts";
import { THREAD_NOT_ARCHIVED_INVARIANT_MARKER } from "@t3tools/shared/errorMessages";
import { normalizeWorkspaceRootForComparison } from "@t3tools/shared/threadWorkspace";
import { Effect } from "effect";

import { OrchestrationCommandInvariantError } from "./Errors.ts";

function invariantError(commandType: string, detail: string): OrchestrationCommandInvariantError {
  return new OrchestrationCommandInvariantError({
    commandType,
    detail,
  });
}

export function findThreadById(
  readModel: OrchestrationReadModel,
  threadId: ThreadId,
): OrchestrationThread | undefined {
  return readModel.threads.find((thread) => thread.id === threadId);
}

export function findProjectById(
  readModel: OrchestrationReadModel,
  projectId: ProjectId,
): OrchestrationProject | undefined {
  return readModel.projects.find((project) => project.id === projectId);
}

export function findTaskById(
  readModel: OrchestrationReadModel,
  taskId: TaskId,
): OrchestrationTask | undefined {
  return readModel.tasks.find((task) => task.id === taskId);
}

// Finds active projects by workspace root using the same comparison rules as import flows.
export function listActiveProjectsByWorkspaceRoot(
  readModel: OrchestrationReadModel,
  workspaceRoot: string,
  options?: { readonly kinds?: ReadonlySet<ProjectKind> },
): ReadonlyArray<OrchestrationProject> {
  const normalizedWorkspaceRoot = normalizeWorkspaceRootForComparison(workspaceRoot, {
    platform: process.platform,
  });
  const acceptedKinds = options?.kinds ?? new Set<ProjectKind>(["project"]);
  return readModel.projects.filter(
    (project) =>
      project.deletedAt === null &&
      acceptedKinds.has(project.kind ?? "project") &&
      normalizeWorkspaceRootForComparison(project.workspaceRoot, {
        platform: process.platform,
      }) === normalizedWorkspaceRoot,
  );
}

export function listThreadsByProjectId(
  readModel: OrchestrationReadModel,
  projectId: ProjectId,
): ReadonlyArray<OrchestrationThread> {
  return readModel.threads.filter((thread) => thread.projectId === projectId);
}

export function listTasksByWorkerId(
  readModel: OrchestrationReadModel,
  workerId: ProjectId,
): ReadonlyArray<OrchestrationTask> {
  return readModel.tasks.filter((task) => task.workerId === workerId);
}

export function requireProject(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly projectId: ProjectId;
}): Effect.Effect<OrchestrationProject, OrchestrationCommandInvariantError> {
  const project = findProjectById(input.readModel, input.projectId);
  if (project) {
    return Effect.succeed(project);
  }
  return Effect.fail(
    invariantError(
      input.command.type,
      `Project '${input.projectId}' does not exist for command '${input.command.type}'.`,
    ),
  );
}

export function requireProjectAbsent(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly projectId: ProjectId;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  if (!findProjectById(input.readModel, input.projectId)) {
    return Effect.void;
  }
  return Effect.fail(
    invariantError(
      input.command.type,
      `Project '${input.projectId}' already exists and cannot be created twice.`,
    ),
  );
}

export function requireProjectWorkspaceRootAvailable(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly workspaceRoot: string;
  readonly excludeProjectId?: ProjectId;
  readonly kinds?: ReadonlySet<ProjectKind>;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  // Skip the excluded project BEFORE picking, not after: if corrupt state ever leaves two
  // active owners on one root, the project being updated must not mask the other owner.
  const existingProject = listActiveProjectsByWorkspaceRoot(
    input.readModel,
    input.workspaceRoot,
    input.kinds ? { kinds: input.kinds } : undefined,
  ).find((project) => project.id !== input.excludeProjectId);
  if (!existingProject) {
    return Effect.void;
  }
  return Effect.fail(
    invariantError(
      input.command.type,
      `Project '${existingProject.id}' already uses workspace root '${existingProject.workspaceRoot}'.`,
    ),
  );
}

export function requireProjectHasNoThreads(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly projectId: ProjectId;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  const remainingThreads = listThreadsByProjectId(input.readModel, input.projectId).filter(
    (thread) => thread.deletedAt === null,
  );
  if (remainingThreads.length === 0) {
    return Effect.void;
  }
  return Effect.fail(
    invariantError(
      input.command.type,
      `Project '${input.projectId}' still has ${remainingThreads.length} thread${remainingThreads.length === 1 ? "" : "s"} and cannot be deleted.`,
    ),
  );
}

export function requireProjectHasNoTasks(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly projectId: ProjectId;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  const remainingTasks = listTasksByWorkerId(input.readModel, input.projectId).filter(
    (task) => task.status !== "completed" && task.status !== "cancelled",
  );
  if (remainingTasks.length === 0) return Effect.void;
  return Effect.fail(
    invariantError(
      input.command.type,
      `Worker '${input.projectId}' still has ${remainingTasks.length} active task${remainingTasks.length === 1 ? "" : "s"} and cannot be deleted.`,
    ),
  );
}

export function requireTask(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly taskId: TaskId;
}): Effect.Effect<OrchestrationTask, OrchestrationCommandInvariantError> {
  const task = findTaskById(input.readModel, input.taskId);
  return task
    ? Effect.succeed(task)
    : Effect.fail(
        invariantError(
          input.command.type,
          `Task '${input.taskId}' does not exist for command '${input.command.type}'.`,
        ),
      );
}

export function requireTaskAbsent(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly taskId: TaskId;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  return findTaskById(input.readModel, input.taskId)
    ? Effect.fail(
        invariantError(
          input.command.type,
          `Task '${input.taskId}' already exists and cannot be created twice.`,
        ),
      )
    : Effect.void;
}

export function requireTaskBelongsToWorker(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly taskId: TaskId;
  readonly workerId: ProjectId;
}): Effect.Effect<OrchestrationTask, OrchestrationCommandInvariantError> {
  return requireTask(input).pipe(
    Effect.flatMap((task) =>
      task.workerId === input.workerId
        ? Effect.succeed(task)
        : Effect.fail(
            invariantError(
              input.command.type,
              `Task '${input.taskId}' belongs to Worker '${task.workerId}', not '${input.workerId}'.`,
            ),
          ),
    ),
  );
}

export function requireThread(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly threadId: ThreadId;
}): Effect.Effect<OrchestrationThread, OrchestrationCommandInvariantError> {
  const thread = findThreadById(input.readModel, input.threadId);
  if (thread && thread.deletedAt === null) {
    return Effect.succeed(thread);
  }
  return Effect.fail(
    invariantError(
      input.command.type,
      thread
        ? `Thread '${input.threadId}' was deleted and cannot handle command '${input.command.type}'.`
        : `Thread '${input.threadId}' does not exist for command '${input.command.type}'.`,
    ),
  );
}

export function requireThreadAbsent(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly threadId: ThreadId;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  if (!findThreadById(input.readModel, input.threadId)) {
    return Effect.void;
  }
  return Effect.fail(
    invariantError(
      input.command.type,
      `Thread '${input.threadId}' already exists and cannot be created twice.`,
    ),
  );
}

export function requireThreadArchived(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly threadId: ThreadId;
}): Effect.Effect<OrchestrationThread, OrchestrationCommandInvariantError> {
  return requireThread(input).pipe(
    Effect.flatMap((thread) =>
      thread.archivedAt != null
        ? Effect.succeed(thread)
        : Effect.fail(
            invariantError(
              input.command.type,
              `Thread '${input.threadId}' ${THREAD_NOT_ARCHIVED_INVARIANT_MARKER} '${input.command.type}'.`,
            ),
          ),
    ),
  );
}

export function requireThreadNotArchived(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly threadId: ThreadId;
}): Effect.Effect<OrchestrationThread, OrchestrationCommandInvariantError> {
  return requireThread(input).pipe(
    Effect.flatMap((thread) =>
      thread.archivedAt == null
        ? Effect.succeed(thread)
        : Effect.fail(
            invariantError(
              input.command.type,
              `Thread '${input.threadId}' is already archived and cannot handle command '${input.command.type}'.`,
            ),
          ),
    ),
  );
}

export function requireNonNegativeInteger(input: {
  readonly commandType: OrchestrationCommand["type"];
  readonly field: string;
  readonly value: number;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  if (Number.isInteger(input.value) && input.value >= 0) {
    return Effect.void;
  }
  return Effect.fail(
    invariantError(
      input.commandType,
      `${input.field} must be an integer greater than or equal to 0.`,
    ),
  );
}
