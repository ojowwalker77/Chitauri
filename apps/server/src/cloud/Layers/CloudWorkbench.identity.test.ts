import {
  CloudBindingId,
  CloudContextId,
  ProjectId,
  type CloudContextSummary,
  type CloudProjectBinding,
} from "@t3tools/contracts";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import { describe, expect, it, vi } from "vitest";

import { GitCore, type GitCoreShape } from "../../git/Services/GitCore";
import {
  ProjectionProjectRepository,
  type ProjectionProjectRepositoryShape,
} from "../../persistence/Services/ProjectionProjects";
import { CloudProviderRegistry, type CloudProviderRegistryShape } from "../CloudProviderRegistry";
import { CloudOperationError } from "../Errors";
import {
  CloudProjectBindings,
  type CloudProjectBindingsShape,
} from "../Services/CloudProjectBindings";
import { CloudWorkbench } from "../Services/CloudWorkbench";
import { CloudWorkbenchLive } from "./CloudWorkbench";

const projectId = ProjectId.makeUnsafe("project-identity-pin");
const binding: CloudProjectBinding = {
  id: CloudBindingId.makeUnsafe("binding-identity-pin"),
  projectId,
  contextId: CloudContextId.makeUnsafe("aws:fake"),
  environment: "Production",
  regions: ["us-east-1"],
  expectedAccountId: "111111111111",
  expectedProjectId: null,
  createdAt: "2026-07-17T00:00:00.000Z",
  updatedAt: "2026-07-17T00:00:00.000Z",
};

const currentContext: CloudContextSummary = {
  id: binding.contextId,
  provider: "aws",
  label: "AWS changed account",
  authState: "authenticated",
  principalLabel: "arn:aws:iam::222222222222:role/ReadOnly",
  accountId: "222222222222",
  projectId: null,
  sourceHost: "test-host",
  expiresAt: null,
  setupInstruction: null,
  warnings: [],
};

describe("CloudWorkbench identity pinning", () => {
  it("re-verifies identity and refuses inventory before a mismatched provider call", async () => {
    const searchResources = vi.fn<CloudProviderRegistryShape["searchResources"]>();
    const services = Layer.mergeAll(
      Layer.succeed(CloudProjectBindings, {
        list: () => Effect.succeed([binding]),
        getById: () => Effect.succeed(Option.some(binding)),
        upsert: (value) => Effect.succeed(value),
        remove: () => Effect.void,
      } satisfies CloudProjectBindingsShape),
      Layer.succeed(ProjectionProjectRepository, {
        getById: () =>
          Effect.succeed(
            Option.some({
              projectId,
              kind: "project",
              title: "Identity pin",
              workspaceRoot: "/tmp/identity-pin",
              defaultModelSelection: null,
              scripts: [],
              isPinned: false,
              createdAt: "2026-07-17T00:00:00.000Z",
              updatedAt: "2026-07-17T00:00:00.000Z",
              deletedAt: null,
            }),
          ),
        listAll: () => Effect.succeed([]),
        upsert: () => Effect.void,
        deleteById: () => Effect.void,
      } satisfies ProjectionProjectRepositoryShape),
      Layer.succeed(CloudProviderRegistry, {
        listContexts: () => Effect.succeed([currentContext]),
        resolveContext: () => Effect.succeed(currentContext),
        searchResources,
        resourceDetail: () => Effect.die(new Error("Unexpected detail call")),
        queryLogs: () => Effect.die(new Error("Unexpected log call")),
      } satisfies CloudProviderRegistryShape),
      Layer.succeed(GitCore, {
        readConfigValue: () => Effect.succeed(null),
      } as unknown as GitCoreShape),
    );
    const program = Effect.gen(function* () {
      const workbench = yield* CloudWorkbench;
      return yield* workbench.searchResources({
        bindingId: binding.id,
        query: null,
        types: [],
        states: [],
        ownership: [],
        cursor: null,
        limit: 50,
      });
    }).pipe(Effect.provide(CloudWorkbenchLive.pipe(Layer.provide(services))));

    const exit = await Effect.runPromiseExit(program);
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const error = Cause.squash(exit.cause);
      expect(error).toBeInstanceOf(CloudOperationError);
      expect((error as CloudOperationError).code).toBe("identity_mismatch");
    }
    expect(searchResources).not.toHaveBeenCalled();
  });
});
