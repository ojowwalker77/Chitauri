import { assert, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import {
  CloudContextSummary,
  CloudError,
  CloudInventoryResult,
  CloudQueryLogsInput,
  CloudUpsertBindingInput,
} from "./cloud";

const decode = <S extends Schema.Top>(schema: S, input: unknown) =>
  Schema.decodeUnknownEffect(schema)(input);

it.effect("preserves structured, actionable provider errors", () =>
  Effect.gen(function* () {
    const error = yield* decode(CloudError, {
      _tag: "CloudError",
      code: "auth_required",
      message: "AWS login expired.",
      retryable: false,
      setupInstruction: "Run aws sso login, then refresh Cloud.",
    });
    assert.strictEqual(Schema.is(CloudError)(error), true);
    assert.strictEqual(error.code, "auth_required");
    assert.strictEqual(error.setupInstruction?.includes("aws sso login"), true);
  }),
);

it.effect("round-trips a normalized inventory page without credential material", () =>
  Effect.gen(function* () {
    const context = yield* decode(CloudContextSummary, {
      id: "aws:profile:production",
      provider: "aws",
      label: "AWS · production",
      authState: "authenticated",
      principalLabel: "arn:aws:sts::123456789012:assumed-role/ReadOnly/jow",
      accountId: "123456789012",
      projectId: null,
      sourceHost: "teacode-host",
      expiresAt: null,
      setupInstruction: null,
      warnings: [],
      accessKeyId: "must-not-cross-the-contract",
    });
    assert.strictEqual("accessKeyId" in context, false);

    const inventory = yield* decode(CloudInventoryResult, {
      binding: {
        id: "binding-1",
        projectId: "project-1",
        contextId: context.id,
        environment: "Production",
        regions: ["us-east-1"],
        expectedAccountId: "123456789012",
        expectedProjectId: null,
        createdAt: "2026-07-17T00:00:00.000Z",
        updatedAt: "2026-07-17T00:00:00.000Z",
      },
      context,
      resources: [
        {
          id: "aws:cmVzb3VyY2U",
          provider: "aws",
          externalId: "arn:aws:lambda:us-east-1:123456789012:function:api",
          type: "lambda:function",
          name: "api",
          accountId: "123456789012",
          projectId: null,
          location: "us-east-1",
          state: null,
          tags: { environment: "production" },
          consoleUrl: "https://console.aws.amazon.com/lambda/home?region=us-east-1",
          ownership: { confidence: "untracked", evidence: [] },
          observedAt: "2026-07-17T00:00:00.000Z",
        },
      ],
      nextCursor: null,
      completeness: "complete",
      syncedAt: "2026-07-17T00:00:00.000Z",
      warnings: [],
    });
    const encoded = yield* Schema.encodeEffect(CloudInventoryResult)(inventory);
    assert.strictEqual(encoded.resources[0]?.name, "api");
    assert.strictEqual(encoded.binding.expectedAccountId, "123456789012");
  }),
);

it.effect("rejects empty binding regions", () =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(
      decode(CloudUpsertBindingInput, {
        id: null,
        projectId: "project-1",
        contextId: "gcp:adc",
        environment: "Production",
        regions: [],
      }),
    );
    assert.strictEqual(exit._tag, "Failure");
  }),
);

it.effect("rejects log queries above the hard 200 row cap", () =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(
      decode(CloudQueryLogsInput, {
        bindingId: "binding-1",
        resourceId: "gcp:cmVzb3VyY2U",
        startTime: "2026-07-17T00:00:00.000Z",
        endTime: "2026-07-17T00:15:00.000Z",
        query: null,
        limit: 201,
      }),
    );
    assert.strictEqual(exit._tag, "Failure");
  }),
);
