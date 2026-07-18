import type { CloudErrorCode } from "@t3tools/contracts";
import { Data } from "effect";

export class CloudOperationError extends Data.TaggedError("CloudOperationError")<{
  readonly code: CloudErrorCode;
  readonly operation: string;
  readonly detail: string;
  readonly retryable: boolean;
  readonly setupInstruction?: string | null;
  readonly cause?: unknown;
}> {
  override get message(): string {
    return this.detail;
  }
}

function safeProviderDetail(cause: unknown): string {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return detail
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "[redacted credential]")
    .replace(/\bya29\.[A-Za-z0-9._-]+\b/g, "[redacted credential]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/(?:\/Users|\/home|\/root)\/[^\s:'"\]]+/g, "[local credential path]")
    .replace(/[A-Z]:\\[^\s:'"\]]+/gi, "[local credential path]")
    .slice(0, 4_096);
}

export function providerError(input: {
  readonly operation: string;
  readonly cause: unknown;
  readonly setupInstruction?: string | null;
}): CloudOperationError {
  const detail = safeProviderDetail(input.cause);
  const normalized = detail.toLowerCase();
  const code: CloudErrorCode =
    normalized.includes("expired") || normalized.includes("login")
      ? "auth_required"
      : normalized.includes("access denied") ||
          normalized.includes("permission denied") ||
          normalized.includes("forbidden") ||
          normalized.includes("unauthorized")
        ? "access_denied"
        : normalized.includes("throttl") || normalized.includes("rate limit")
          ? "rate_limited"
          : normalized.includes("not enabled") || normalized.includes("not configured")
            ? "not_configured"
            : "provider_error";
  return new CloudOperationError({
    code,
    operation: input.operation,
    detail,
    retryable: code === "rate_limited" || code === "provider_error",
    ...(input.setupInstruction !== undefined ? { setupInstruction: input.setupInstruction } : {}),
    cause: input.cause,
  });
}
