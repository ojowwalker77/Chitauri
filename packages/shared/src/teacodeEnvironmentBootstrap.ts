// FILE: teacodeEnvironmentBootstrap.ts
// Purpose: Apply the TeaCode -> Chitauri environment compatibility bridge before runtime modules load.

import { applyTeaCodeEnvironmentCompatibility } from "@t3tools/shared/productIdentity";

const { legacyKeysUsed } = applyTeaCodeEnvironmentCompatibility();
if (legacyKeysUsed.length > 0) {
  console.warn(
    `[TeaCode] Legacy environment keys are deprecated; use ${legacyKeysUsed
      .map((key) => key.replace(/^CHITAURI_/, "TEACODE_"))
      .join(", ")} instead.`,
  );
}
