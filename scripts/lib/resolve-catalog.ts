/**
 * Resolve `catalog:` dependency specs using the workspace catalog.
 *
 * Pure function: returns a new record with every `catalog:…` value replaced by
 * the concrete version string found in `catalog`. Throws on missing entries.
 */
export function resolveCatalogDependencies(
  dependencies: Record<string, unknown>,
  catalog: Record<string, unknown>,
  label: string,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(dependencies).map(([name, spec]) => {
      if (typeof spec !== "string" || !spec.startsWith("catalog:")) {
        return [name, spec];
      }

      const catalogKey = spec.slice("catalog:".length).trim();
      const lookupKey = catalogKey.length > 0 ? catalogKey : name;
      const resolved = catalog[lookupKey];

      if (typeof resolved !== "string" || resolved.length === 0) {
        throw new Error(
          `Unable to resolve '${spec}' for ${label} dependency '${name}'. Expected key '${lookupKey}' in root workspace catalog.`,
        );
      }

      return [name, resolved];
    }),
  );
}

/**
 * Rebase repository-local vendored tarballs for a package.json written to a
 * temporary `app/` directory. The sibling `vendor/` directory stays outside
 * the packaged application after Bun installs the dependencies.
 */
export function rebaseVendoredDependenciesForStaging(
  dependencies: Record<string, unknown>,
): Record<string, unknown> {
  const vendorMarker = "vendor/effect/";

  return Object.fromEntries(
    Object.entries(dependencies).map(([name, spec]) => {
      if (typeof spec !== "string" || !spec.startsWith("file:")) {
        return [name, spec];
      }

      const normalizedSpec = spec.replaceAll("\\", "/");
      const vendorIndex = normalizedSpec.indexOf(vendorMarker);
      if (vendorIndex === -1) {
        return [name, spec];
      }

      return [name, `file:../${normalizedSpec.slice(vendorIndex)}`];
    }),
  );
}
