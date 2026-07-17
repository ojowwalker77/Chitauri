import { describe, expect, it } from "vitest";

import {
  applyTeaCodeEnvironmentCompatibility,
  readTeaCodeEnvironmentValue,
} from "./productIdentity";

describe("TeaCode environment compatibility", () => {
  it("makes canonical values win and mirrors them for legacy consumers", () => {
    const env = {
      TEACODE_HOME: "/canonical",
      CHITAURI_HOME: "/legacy",
    } as NodeJS.ProcessEnv;

    expect(applyTeaCodeEnvironmentCompatibility(env).legacyKeysUsed).toEqual([]);
    expect(env.TEACODE_HOME).toBe("/canonical");
    expect(env.CHITAURI_HOME).toBe("/canonical");
  });

  it("accepts legacy values during the compatibility window", () => {
    const env = { CHITAURI_PORT: "3773" } as NodeJS.ProcessEnv;

    expect(applyTeaCodeEnvironmentCompatibility(env).legacyKeysUsed).toEqual(["CHITAURI_PORT"]);
    expect(env.TEACODE_PORT).toBe("3773");
    expect(readTeaCodeEnvironmentValue(env, "PORT")).toBe("3773");
  });

  it("does not touch unrelated environment keys", () => {
    const env = { PATH: "/bin" } as NodeJS.ProcessEnv;

    applyTeaCodeEnvironmentCompatibility(env);
    expect(env).toEqual({ PATH: "/bin" });
  });
});
