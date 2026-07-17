import { assert, it } from "@effect/vitest";
import { Schema } from "effect";

import { ServerSettings, ServerSettingsPatch } from "./settings";

it("defaults new threads to full access", () => {
  const settings = Schema.decodeSync(ServerSettings)({});
  assert.strictEqual(settings.defaultRuntimeMode, "full-access");
});

it("accepts a default permissions mode patch", () => {
  const patch = Schema.decodeSync(ServerSettingsPatch)({
    defaultRuntimeMode: "approval-required",
  });
  assert.strictEqual(patch.defaultRuntimeMode, "approval-required");
});
