import { describe, expect, it } from "vitest";

import { resolveSpawnAgentProvider } from "./agentSpawnProvider";

describe("resolveSpawnAgentProvider", () => {
  it("maps the shell-out CLIs to their provider", () => {
    expect(resolveSpawnAgentProvider("agy --model gemini-3.5-flash -p 'scout'")).toBe("gemini");
    expect(resolveSpawnAgentProvider("opencode run -m opencode/big-pickle 'review'")).toBe(
      "opencode",
    );
    expect(resolveSpawnAgentProvider("codex exec -m gpt-5.5 -c effort=high 'build'")).toBe("codex");
    expect(resolveSpawnAgentProvider("grok --prompt 'x'")).toBe("grok");
    expect(resolveSpawnAgentProvider("cursor-agent 'do a thing'")).toBe("cursor");
    expect(resolveSpawnAgentProvider("claude -p 'summarize'")).toBe("claudeAgent");
  });

  it("does not mistake opencode for codex", () => {
    expect(resolveSpawnAgentProvider("opencode run 'x'")).toBe("opencode");
  });

  it("returns null for a plain command or missing input", () => {
    expect(resolveSpawnAgentProvider("ls -la && echo done")).toBeNull();
    expect(resolveSpawnAgentProvider("")).toBeNull();
    expect(resolveSpawnAgentProvider(null)).toBeNull();
    expect(resolveSpawnAgentProvider(undefined)).toBeNull();
  });
});
