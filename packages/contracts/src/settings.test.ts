import { assert, it } from "@effect/vitest";
import { Schema } from "effect";

import {
  DEFAULT_ORCHESTRATOR_ROUTING_POLICY,
  ServerSettings,
  ServerSettingsPatch,
} from "./settings";

it("decodes the default orchestrator routing policy", () => {
  const settings = Schema.decodeSync(ServerSettings)({});
  assert.deepStrictEqual(settings.orchestrator, DEFAULT_ORCHESTRATOR_ROUTING_POLICY);
  assert.strictEqual(settings.orchestrator.lanes.bulk.modelSelection.model, "gpt-5.6-terra");
  assert.strictEqual(
    settings.orchestrator.lanes.ui.modelSelection.options?.effort,
    "high",
  );
});

it("accepts an atomic orchestrator routing policy patch", () => {
  const patch = Schema.decodeSync(ServerSettingsPatch)({
    orchestrator: {
      ...DEFAULT_ORCHESTRATOR_ROUTING_POLICY,
      autoVerifyDiffs: true,
    },
  });
  assert.strictEqual(patch.orchestrator?.autoVerifyDiffs, true);
});
