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
  const ui = settings.orchestrator.lanes.ui.modelSelection;
  assert.strictEqual(ui.provider, "claudeAgent");
  assert.strictEqual(ui.provider === "claudeAgent" ? ui.options?.effort : undefined, "high");
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

it("rejects orchestrator seats that cannot receive the control-plane MCP", () => {
  assert.throws(() =>
    Schema.decodeUnknownSync(ServerSettingsPatch)({
      orchestrator: {
        ...DEFAULT_ORCHESTRATOR_ROUTING_POLICY,
        seatModels: [{ provider: "cursor", model: "unsupported-seat" }],
      },
    }),
  );
  assert.throws(() =>
    Schema.decodeSync(ServerSettingsPatch)({
      orchestrator: {
        ...DEFAULT_ORCHESTRATOR_ROUTING_POLICY,
        seatModels: [],
      },
    }),
  );
});
