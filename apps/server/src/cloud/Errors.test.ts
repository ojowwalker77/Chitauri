import { describe, expect, it } from "vitest";

import { providerError } from "./Errors";

describe("cloud provider errors", () => {
  it("classifies actionable failures without leaking credential material or local paths", () => {
    const error = providerError({
      operation: "aws.searchResources",
      cause: new Error("Access denied for AKIAABCDEFGHIJKLMNOP from /Users/test/.aws/credentials"),
    });

    expect(error.code).toBe("access_denied");
    expect(error.detail).toContain("[redacted credential]");
    expect(error.detail).toContain("[local credential path]");
    expect(error.detail).not.toContain("AKIAABCDEFGHIJKLMNOP");
    expect(error.detail).not.toContain("/Users/test/.aws/credentials");
  });

  it.each([
    ["request was throttled", "rate_limited", true],
    ["API is not enabled", "not_configured", false],
    ["login expired", "auth_required", false],
  ] as const)("classifies %s", (detail, code, retryable) => {
    const error = providerError({ operation: "provider.read", cause: new Error(detail) });
    expect(error.code).toBe(code);
    expect(error.retryable).toBe(retryable);
  });
});
