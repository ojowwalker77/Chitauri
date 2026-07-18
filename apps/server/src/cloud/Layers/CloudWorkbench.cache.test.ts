import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import { CloudOperationError } from "../Errors";
import { makeCloudReadCache } from "./CloudWorkbench";

describe("CloudWorkbench read cache", () => {
  it("deduplicates concurrent reads and reuses a bounded TTL result", async () => {
    let finish: ((value: number) => void) | null = null;
    let providerCalls = 0;
    const providerRead = () =>
      Effect.promise(() => {
        providerCalls += 1;
        return new Promise<number>((resolve) => {
          finish = resolve;
        });
      });
    const cache = makeCloudReadCache<number>();
    const first = Effect.runPromise(
      cache({ key: "inventory-page", ttlMs: 10_000, read: providerRead() }),
    );
    const second = Effect.runPromise(
      cache({ key: "inventory-page", ttlMs: 10_000, read: providerRead() }),
    );

    await vi.waitFor(() => expect(finish).not.toBeNull());
    expect(providerCalls).toBe(1);
    finish!(42);
    await expect(Promise.all([first, second])).resolves.toEqual([42, 42]);

    const cached = await Effect.runPromise(
      cache({ key: "inventory-page", ttlMs: 10_000, read: providerRead() }),
    );
    expect(cached).toBe(42);
    expect(providerCalls).toBe(1);
  });

  it("does not retain a failed provider result", async () => {
    const cache = makeCloudReadCache<number>();
    const read = Effect.fail(
      new CloudOperationError({
        code: "provider_error",
        operation: "test",
        detail: "provider failed",
        retryable: true,
      }),
    );

    await Effect.runPromiseExit(cache({ key: "detail", ttlMs: 10_000, read }));
    const second = await Effect.runPromiseExit(
      cache({ key: "detail", ttlMs: 10_000, read: Effect.succeed(7) }),
    );

    expect(second).toMatchObject({ _tag: "Success", value: 7 });
  });
});
