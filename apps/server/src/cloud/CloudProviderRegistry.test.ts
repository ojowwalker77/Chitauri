import {
  CloudBindingId,
  CloudContextId,
  CloudResourceId,
  ProjectId,
  type CloudContextSummary,
  type CloudProjectBinding,
} from "@t3tools/contracts";
import { Effect, Exit } from "effect";
import { describe, expect, it, vi } from "vitest";

import { makeCloudProviderRegistry, type CloudProviderAdapter } from "./CloudProviderRegistry";

const awsContext: CloudContextSummary = {
  id: CloudContextId.makeUnsafe("aws:fake"),
  provider: "aws",
  label: "AWS fake",
  authState: "authenticated",
  principalLabel: "arn:aws:iam::123456789012:role/ReadOnly",
  accountId: "123456789012",
  projectId: null,
  sourceHost: "test-host",
  expiresAt: null,
  setupInstruction: null,
  warnings: [],
};

const awsBinding: CloudProjectBinding = {
  id: CloudBindingId.makeUnsafe("binding-fake"),
  projectId: ProjectId.makeUnsafe("project-fake"),
  contextId: awsContext.id,
  environment: "Test",
  regions: ["us-east-1"],
  expectedAccountId: "123456789012",
  expectedProjectId: null,
  createdAt: "2026-07-17T00:00:00.000Z",
  updatedAt: "2026-07-17T00:00:00.000Z",
};

function fakeAdapter(input: {
  provider: "aws" | "gcp";
  contexts: readonly CloudContextSummary[];
  searchResources?: CloudProviderAdapter["searchResources"];
}): CloudProviderAdapter {
  return {
    provider: input.provider,
    listContexts: () => Effect.succeed(input.contexts),
    resolveContext: (contextId) => {
      const context = input.contexts.find((candidate) => candidate.id === contextId);
      return context
        ? Effect.succeed(context)
        : Effect.die(new Error(`Unexpected fake context ${contextId}`));
    },
    searchResources:
      input.searchResources ?? (() => Effect.die(new Error("Unexpected fake inventory request"))),
    resourceDetail: () => Effect.die(new Error("Unexpected fake detail request")),
    queryLogs: () => Effect.die(new Error("Unexpected fake log request")),
  };
}

describe("CloudProviderRegistry", () => {
  it("combines contexts while dispatching inventory only to the context provider", async () => {
    const awsSearch = vi.fn<CloudProviderAdapter["searchResources"]>(() =>
      Effect.succeed({
        resources: [],
        nextCursor: "opaque-next-page",
        completeness: "partial",
        warnings: ["One region was throttled."],
      }),
    );
    const gcpContext: CloudContextSummary = {
      ...awsContext,
      id: CloudContextId.makeUnsafe("gcp:fake"),
      provider: "gcp",
      label: "GCP fake",
      principalLabel: null,
      accountId: null,
      projectId: "gcp-project",
    };
    const registry = makeCloudProviderRegistry([
      fakeAdapter({ provider: "aws", contexts: [awsContext], searchResources: awsSearch }),
      fakeAdapter({ provider: "gcp", contexts: [gcpContext] }),
    ]);

    await expect(Effect.runPromise(registry.listContexts())).resolves.toEqual([
      awsContext,
      gcpContext,
    ]);
    await expect(
      Effect.runPromise(
        registry.searchResources({
          binding: awsBinding,
          context: awsContext,
          request: {
            bindingId: awsBinding.id,
            query: null,
            types: [],
            states: [],
            ownership: [],
            cursor: null,
            limit: 50,
          },
        }),
      ),
    ).resolves.toMatchObject({
      nextCursor: "opaque-next-page",
      completeness: "partial",
    });
    expect(awsSearch).toHaveBeenCalledOnce();
  });

  it("rejects unsupported context prefixes before any provider call", async () => {
    const registry = makeCloudProviderRegistry([
      fakeAdapter({ provider: "aws", contexts: [awsContext] }),
    ]);
    const exit = await Effect.runPromiseExit(
      registry.resolveContext(CloudContextId.makeUnsafe("azure:unexpected")),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(String(exit.cause)).toContain("unsupported provider");
    }
  });

  it("does not route a forged cross-provider resource id through the wrong adapter", async () => {
    const detail = vi.fn<CloudProviderAdapter["resourceDetail"]>();
    const registry = makeCloudProviderRegistry([
      {
        ...fakeAdapter({ provider: "aws", contexts: [awsContext] }),
        resourceDetail: detail.mockReturnValue(
          Effect.die(new Error("The adapter must validate the resource scope")),
        ),
      },
    ]);

    await Effect.runPromiseExit(
      registry.resourceDetail({
        binding: awsBinding,
        context: awsContext,
        request: {
          bindingId: awsBinding.id,
          resourceId: CloudResourceId.makeUnsafe("gcp:forged"),
        },
      }),
    );
    expect(detail).toHaveBeenCalledOnce();
  });
});
