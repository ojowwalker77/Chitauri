import { describe, expect, it } from "vitest";

import {
  rebaseVendoredDependenciesForStaging,
  resolveCatalogDependencies,
} from "./resolve-catalog";

describe("resolveCatalogDependencies", () => {
  it("resolves named and default catalog entries", () => {
    expect(
      resolveCatalogDependencies(
        { effect: "catalog:", aliased: "catalog:effect", stable: "1.0.0" },
        { effect: "file:../../vendor/effect/effect.tgz" },
        "test",
      ),
    ).toEqual({
      effect: "file:../../vendor/effect/effect.tgz",
      aliased: "file:../../vendor/effect/effect.tgz",
      stable: "1.0.0",
    });
  });
});

describe("rebaseVendoredDependenciesForStaging", () => {
  it("rebases Effect tarballs while preserving unrelated specs", () => {
    expect(
      rebaseVendoredDependenciesForStaging({
        effect: "file:../../vendor/effect/effect.tgz",
        platform: "file:./vendor/effect/platform.tgz",
        localPackage: "file:../other/package.tgz",
        react: "19.0.0",
      }),
    ).toEqual({
      effect: "file:../vendor/effect/effect.tgz",
      platform: "file:../vendor/effect/platform.tgz",
      localPackage: "file:../other/package.tgz",
      react: "19.0.0",
    });
  });
});
