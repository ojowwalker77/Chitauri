import {
  CloudBindingId,
  type CloudContextSummary,
  type CloudOwnership,
  type CloudProjectBinding,
  type CloudProjectDiscoveryResult,
  type CloudResourceSummary,
} from "@t3tools/contracts";
import { Effect, Exit, Layer, Option, Semaphore } from "effect";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";

import { GitCore } from "../../git/Services/GitCore";
import {
  ProjectionProjectRepository,
  type ProjectionProject,
} from "../../persistence/Services/ProjectionProjects";
import {
  CloudProviderRegistry,
  type CloudProviderInventoryPage,
  type CloudProviderResourceDetail,
} from "../CloudProviderRegistry";
import { CloudOperationError } from "../Errors";
import { discoverCloudProject } from "../projectDiscovery";
import { CloudProjectBindings } from "../Services/CloudProjectBindings";
import { CloudWorkbench, type CloudWorkbenchShape } from "../Services/CloudWorkbench";

const DISCOVERY_CACHE_TTL_MS = 60_000;
const INVENTORY_CACHE_TTL_MS = 15_000;
const DETAIL_CACHE_TTL_MS = 10_000;
const MAX_PROVIDER_CACHE_ENTRIES = 256;

export function makeCloudReadCache<A>() {
  const values = new Map<string, { readonly expiresAt: number; readonly value: A }>();
  const inFlight = new Map<string, Promise<Exit.Exit<A, CloudOperationError>>>();

  const prune = () => {
    const now = Date.now();
    for (const [key, entry] of values) {
      if (entry.expiresAt <= now) values.delete(key);
    }
    while (values.size >= MAX_PROVIDER_CACHE_ENTRIES) {
      const oldest = values.keys().next().value;
      if (oldest === undefined) break;
      values.delete(oldest);
    }
  };

  return (input: {
    readonly key: string;
    readonly ttlMs: number;
    readonly read: Effect.Effect<A, CloudOperationError>;
  }): Effect.Effect<A, CloudOperationError> =>
    Effect.suspend(() => {
      const cached = values.get(input.key);
      if (cached && cached.expiresAt > Date.now()) return Effect.succeed(cached.value);

      const running = inFlight.get(input.key);
      const promise = running ?? Effect.runPromiseExit(input.read);
      if (!running) {
        inFlight.set(input.key, promise);
        void promise.then((exit) => {
          if (Exit.isSuccess(exit)) {
            prune();
            values.set(input.key, {
              expiresAt: Date.now() + input.ttlMs,
              value: exit.value,
            });
          }
          if (inFlight.get(input.key) === promise) inFlight.delete(input.key);
        });
      }
      return Effect.promise(() => promise).pipe(
        Effect.flatMap((exit) =>
          Exit.isSuccess(exit) ? Effect.succeed(exit.value) : Effect.failCause(exit.cause),
        ),
      );
    });
}

function fail(input: ConstructorParameters<typeof CloudOperationError>[0]) {
  return Effect.fail(new CloudOperationError(input));
}

function requireAuthenticated(context: CloudContextSummary) {
  if (context.authState === "authenticated") return Effect.succeed(context);
  return fail({
    code: "auth_required",
    operation: "cloud.identity",
    detail:
      context.warnings[0] ?? `${context.label} is not authenticated on ${context.sourceHost}.`,
    retryable: context.authState === "error",
    setupInstruction: context.setupInstruction,
  });
}

function normalizeRepositoryRemote(value: string): string {
  return value
    .trim()
    .replace(/^git@([^:]+):/i, "https://$1/")
    .replace(/^ssh:\/\/git@/i, "https://")
    .replace(/\.git$/i, "")
    .replace(/\/$/, "")
    .toLowerCase();
}

function ownershipForResource(input: {
  readonly resource: CloudResourceSummary;
  readonly discovery: CloudProjectDiscoveryResult;
  readonly repositoryRemote: string | null;
  readonly projectName: string;
  readonly environment: string;
}): CloudOwnership {
  const remote = input.repositoryRemote ? normalizeRepositoryRemote(input.repositoryRemote) : null;
  const repositoryTag = Object.entries(input.resource.tags).find(([key]) =>
    ["repository", "repo", "source_repository", "vcs_url"].includes(key.toLowerCase()),
  );
  if (remote && repositoryTag && normalizeRepositoryRemote(repositoryTag[1]) === remote) {
    return {
      confidence: "exact",
      evidence: [
        {
          path: null,
          reason: `Resource tag '${repositoryTag[0]}' matches this repository.`,
          source: "tag",
        },
      ],
    };
  }

  const normalizedName = input.resource.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const sourceEvidence = input.discovery.evidence.find((evidence) => {
    const normalizedPath = evidence.path.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    return normalizedName.length >= 3 && normalizedPath.includes(normalizedName);
  });
  if (sourceEvidence) {
    return {
      confidence: "probable",
      evidence: [
        {
          path: sourceEvidence.path,
          reason: `Resource name matches ${sourceEvidence.tool} repository evidence.`,
          source: "repository",
        },
      ],
    };
  }

  const environmentTag = Object.entries(input.resource.tags).find(
    ([key, value]) =>
      ["environment", "env", "stage"].includes(key.toLowerCase()) &&
      value.toLowerCase() === input.environment.toLowerCase(),
  );
  const normalizedProjectName = input.projectName.trim().toLowerCase();
  const projectTag = Object.entries(input.resource.tags).find(
    ([key, value]) =>
      ["project", "application", "app", "service"].includes(key.toLowerCase()) &&
      normalizedProjectName.length >= 3 &&
      value.toLowerCase().includes(normalizedProjectName),
  );
  if (environmentTag && projectTag) {
    return {
      confidence: "probable",
      evidence: [
        {
          path: null,
          reason: `Resource project and environment tags match this binding.`,
          source: "tag",
        },
      ],
    };
  }
  return { confidence: "untracked", evidence: [] };
}

export const CloudWorkbenchLive = Layer.effect(
  CloudWorkbench,
  Effect.gen(function* () {
    const bindings = yield* CloudProjectBindings;
    const git = yield* GitCore;
    const projects = yield* ProjectionProjectRepository;
    const providers = yield* CloudProviderRegistry;
    const globalProviderReads = yield* Semaphore.make(4);
    const providerReadsByContext = new Map<string, Semaphore.Semaphore>();
    const cachedInventory = makeCloudReadCache<CloudProviderInventoryPage>();
    const cachedDetail = makeCloudReadCache<CloudProviderResourceDetail>();
    const discoveryCache = new Map<
      string,
      { readonly expiresAt: number; readonly result: CloudProjectDiscoveryResult }
    >();

    const boundedProviderRead = <A>(
      contextId: CloudContextSummary["id"],
      read: Effect.Effect<A, CloudOperationError>,
    ) => {
      let contextSemaphore = providerReadsByContext.get(contextId);
      if (!contextSemaphore) {
        contextSemaphore = Semaphore.makeUnsafe(2);
        providerReadsByContext.set(contextId, contextSemaphore);
      }
      return globalProviderReads.withPermit(contextSemaphore.withPermit(read));
    };

    const requireProject = Effect.fnUntraced(function* (
      projectId: CloudProjectBinding["projectId"],
    ) {
      const project = Option.getOrNull(yield* projects.getById({ projectId }));
      if (!project || project.deletedAt !== null || project.kind !== "project") {
        return yield* fail({
          code: "project_not_found",
          operation: "cloud.project",
          detail: "Cloud requires an active repository project.",
          retryable: false,
        });
      }
      return project;
    });

    const discoveryForProject = Effect.fnUntraced(function* (project: ProjectionProject) {
      const cached = discoveryCache.get(project.workspaceRoot);
      if (cached && cached.expiresAt > Date.now()) return cached.result;
      const result = yield* Effect.tryPromise({
        try: () =>
          discoverCloudProject({ root: project.workspaceRoot, projectId: project.projectId }),
        catch: (cause) =>
          new CloudOperationError({
            code: "project_not_found",
            operation: "cloud.discoverProject",
            detail: cause instanceof Error ? cause.message : "Repository discovery failed.",
            retryable: false,
            cause,
          }),
      });
      discoveryCache.set(project.workspaceRoot, {
        expiresAt: Date.now() + DISCOVERY_CACHE_TTL_MS,
        result,
      });
      return result;
    });

    const resolveBinding = Effect.fnUntraced(function* (bindingId: CloudBindingId) {
      const binding = Option.getOrNull(yield* bindings.getById(bindingId));
      if (!binding) {
        return yield* fail({
          code: "binding_not_found",
          operation: "cloud.binding",
          detail: "This cloud binding no longer exists.",
          retryable: false,
        });
      }
      const project = yield* requireProject(binding.projectId);
      const context = yield* providers
        .resolveContext(binding.contextId)
        .pipe(Effect.flatMap(requireAuthenticated));
      const matchesPinnedIdentity =
        (context.provider === "aws" &&
          binding.expectedAccountId !== null &&
          context.accountId === binding.expectedAccountId) ||
        (context.provider === "gcp" &&
          binding.expectedProjectId !== null &&
          context.projectId === binding.expectedProjectId);
      if (!matchesPinnedIdentity) {
        return yield* fail({
          code: "identity_mismatch",
          operation: "cloud.identity",
          detail: `Current ${context.provider.toUpperCase()} identity does not match the scope pinned by this binding.`,
          retryable: false,
          setupInstruction: context.setupInstruction,
        });
      }
      return { binding, context, project } as const;
    });

    const repositoryRemote = (workspaceRoot: string) =>
      git
        .readConfigValue(workspaceRoot, "remote.origin.url")
        .pipe(Effect.catch(() => Effect.succeed(null)));

    const attachOwnership = Effect.fnUntraced(function* (
      resources: ReadonlyArray<CloudResourceSummary>,
      binding: CloudProjectBinding,
      project: ProjectionProject,
    ) {
      const [discovery, remote] = yield* Effect.all([
        discoveryForProject(project),
        repositoryRemote(project.workspaceRoot),
      ]);
      return resources.map((resource) => ({
        ...resource,
        ownership: ownershipForResource({
          resource,
          discovery,
          repositoryRemote: remote,
          projectName: project.title,
          environment: binding.environment,
        }),
      }));
    });

    const listContexts: CloudWorkbenchShape["listContexts"] = () =>
      providers.listContexts().pipe(
        Effect.map((contexts) => ({
          contexts: [...contexts].toSorted((left, right) =>
            `${left.provider}:${left.label}`.localeCompare(`${right.provider}:${right.label}`),
          ),
          sourceHost: (contexts[0]?.sourceHost ?? hostname() ?? "TeaCode server").slice(0, 256),
          syncedAt: new Date().toISOString(),
        })),
      );

    const discoverProject: CloudWorkbenchShape["discoverProject"] = (input) =>
      requireProject(input.projectId).pipe(Effect.flatMap(discoveryForProject));

    const listBindings: CloudWorkbenchShape["listBindings"] = (input) =>
      bindings.list(input.projectId).pipe(Effect.map((rows) => ({ bindings: rows })));

    const upsertBinding: CloudWorkbenchShape["upsertBinding"] = (input) =>
      Effect.gen(function* () {
        yield* requireProject(input.projectId);
        const context = yield* providers
          .resolveContext(input.contextId)
          .pipe(Effect.flatMap(requireAuthenticated));
        const expectedAccountId = context.provider === "aws" ? context.accountId : null;
        const expectedProjectId = context.provider === "gcp" ? context.projectId : null;
        if (
          (context.provider === "aws" && !expectedAccountId) ||
          (context.provider === "gcp" && !expectedProjectId)
        ) {
          return yield* fail({
            code: "auth_required",
            operation: "cloud.upsertBinding",
            detail: "Cloud identity preview did not return a pinnable external scope.",
            retryable: false,
            setupInstruction: context.setupInstruction,
          });
        }
        const existingById = input.id ? Option.getOrNull(yield* bindings.getById(input.id)) : null;
        if (input.id && !existingById) {
          return yield* fail({
            code: "binding_not_found",
            operation: "cloud.upsertBinding",
            detail: "This cloud binding no longer exists.",
            retryable: false,
          });
        }
        const existing =
          existingById ??
          (yield* bindings.list(input.projectId)).find(
            (binding) =>
              binding.contextId === input.contextId && binding.environment === input.environment,
          ) ??
          null;
        if (existing && existing.projectId !== input.projectId) {
          return yield* fail({
            code: "invalid_scope",
            operation: "cloud.upsertBinding",
            detail: "A cloud binding cannot be moved between repository projects.",
            retryable: false,
          });
        }
        const now = new Date().toISOString();
        const binding: CloudProjectBinding = {
          id: existing?.id ?? CloudBindingId.makeUnsafe(randomUUID()),
          projectId: input.projectId,
          contextId: input.contextId,
          environment: input.environment,
          regions: [
            ...new Set(input.regions.map((region) => region.trim().toLowerCase()).filter(Boolean)),
          ],
          expectedAccountId,
          expectedProjectId,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        };
        if (binding.regions.length === 0) {
          return yield* fail({
            code: "invalid_scope",
            operation: "cloud.upsertBinding",
            detail: "Choose at least one allowed region or location.",
            retryable: false,
          });
        }
        if (binding.regions.some((region) => !/^[a-z0-9][a-z0-9-]{0,62}$/.test(region))) {
          return yield* fail({
            code: "invalid_scope",
            operation: "cloud.upsertBinding",
            detail:
              "Cloud regions and locations may contain only lowercase letters, digits, and hyphens.",
            retryable: false,
          });
        }
        if (
          context.provider === "aws" &&
          binding.regions.every((region) => region.toLowerCase() === "global")
        ) {
          return yield* fail({
            code: "invalid_scope",
            operation: "cloud.upsertBinding",
            detail: "AWS bindings require at least one searchable AWS region.",
            retryable: false,
          });
        }
        return yield* bindings.upsert(binding);
      });

    const searchResources: CloudWorkbenchShape["searchResources"] = (input) =>
      Effect.gen(function* () {
        const resolved = yield* resolveBinding(input.bindingId);
        const page = yield* cachedInventory({
          key: JSON.stringify([resolved.binding.id, resolved.binding.updatedAt, input]),
          ttlMs: INVENTORY_CACHE_TTL_MS,
          read: boundedProviderRead(
            resolved.context.id,
            providers.searchResources({
              binding: resolved.binding,
              context: resolved.context,
              request: input,
            }),
          ),
        });
        const owned = yield* attachOwnership(page.resources, resolved.binding, resolved.project);
        const resources = owned.filter(
          (resource) =>
            (input.ownership.length === 0 ||
              input.ownership.includes(resource.ownership.confidence)) &&
            (input.states.length === 0 ||
              (resource.state !== null && input.states.includes(resource.state))),
        );
        return {
          binding: resolved.binding,
          context: resolved.context,
          resources,
          nextCursor: page.nextCursor,
          completeness: page.completeness,
          syncedAt: new Date().toISOString(),
          warnings: [...resolved.context.warnings, ...page.warnings].slice(0, 64),
        };
      });

    const resourceDetail: CloudWorkbenchShape["resourceDetail"] = (input) =>
      Effect.gen(function* () {
        const resolved = yield* resolveBinding(input.bindingId);
        const detail = yield* cachedDetail({
          key: JSON.stringify([resolved.binding.id, resolved.binding.updatedAt, input.resourceId]),
          ttlMs: DETAIL_CACHE_TTL_MS,
          read: boundedProviderRead(
            resolved.context.id,
            providers.resourceDetail({
              binding: resolved.binding,
              context: resolved.context,
              request: input,
            }),
          ),
        });
        const [resource] = yield* attachOwnership(
          [detail.resource],
          resolved.binding,
          resolved.project,
        );
        if (!resource) {
          return yield* fail({
            code: "provider_error",
            operation: "cloud.resourceDetail",
            detail: "Cloud provider returned no normalized resource detail.",
            retryable: true,
          });
        }
        return {
          binding: resolved.binding,
          context: resolved.context,
          resource,
          health: detail.health,
          activity: detail.activity,
          completeness: detail.completeness,
          warnings: [...resolved.context.warnings, ...detail.warnings].slice(0, 64),
          syncedAt: new Date().toISOString(),
        };
      });

    const queryLogs: CloudWorkbenchShape["queryLogs"] = (input) =>
      Effect.gen(function* () {
        const start = new Date(input.startTime);
        const end = new Date(input.endTime);
        if (
          Number.isNaN(start.valueOf()) ||
          Number.isNaN(end.valueOf()) ||
          start >= end ||
          end.valueOf() - start.valueOf() > 24 * 60 * 60_000
        ) {
          return yield* fail({
            code: "invalid_scope",
            operation: "cloud.queryLogs",
            detail: "Cloud log queries require a valid range no wider than 24 hours.",
            retryable: false,
          });
        }
        const resolved = yield* resolveBinding(input.bindingId);
        const page = yield* boundedProviderRead(
          resolved.context.id,
          providers.queryLogs({
            binding: resolved.binding,
            context: resolved.context,
            request: input,
          }),
        );
        return {
          binding: resolved.binding,
          context: resolved.context,
          resourceId: input.resourceId,
          entries: page.entries.slice(0, input.limit),
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          completeness: page.completeness,
          warnings: [...resolved.context.warnings, ...page.warnings].slice(0, 64),
          queriedAt: new Date().toISOString(),
        };
      });

    return {
      listContexts,
      discoverProject,
      listBindings,
      upsertBinding,
      searchResources,
      resourceDetail,
      queryLogs,
    } satisfies CloudWorkbenchShape;
  }),
);
