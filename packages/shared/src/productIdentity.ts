// FILE: productIdentity.ts
// Purpose: Canonical TeaCode identity plus the temporary Chitauri environment compatibility bridge.

export const PRODUCT_NAME = "TeaCode";
export const PRODUCT_BUNDLE_ID = "dev.jow.TeaCode";
export const PRODUCT_HOME_DIRNAME = ".teacode";
export const PRODUCT_ENV_PREFIX = "TEACODE_";
export const LEGACY_PRODUCT_ENV_PREFIX = "CHITAURI_";

export interface EnvironmentCompatibilityResult {
  readonly legacyKeysUsed: readonly string[];
}

/**
 * Mirrors TeaCode and legacy Chitauri environment keys for one compatibility
 * window. TeaCode always wins when both names are supplied.
 */
export function applyTeaCodeEnvironmentCompatibility(
  env: NodeJS.ProcessEnv = process.env,
): EnvironmentCompatibilityResult {
  const suffixes = new Set<string>();
  for (const key of Object.keys(env)) {
    if (key.startsWith(PRODUCT_ENV_PREFIX)) {
      suffixes.add(key.slice(PRODUCT_ENV_PREFIX.length));
    } else if (key.startsWith(LEGACY_PRODUCT_ENV_PREFIX)) {
      suffixes.add(key.slice(LEGACY_PRODUCT_ENV_PREFIX.length));
    }
  }

  const legacyKeysUsed: string[] = [];
  for (const suffix of suffixes) {
    const canonicalKey = `${PRODUCT_ENV_PREFIX}${suffix}`;
    const legacyKey = `${LEGACY_PRODUCT_ENV_PREFIX}${suffix}`;
    const canonicalValue = env[canonicalKey];
    const legacyValue = env[legacyKey];

    if (canonicalValue !== undefined) {
      env[legacyKey] = canonicalValue;
      continue;
    }
    if (legacyValue !== undefined) {
      env[canonicalKey] = legacyValue;
      legacyKeysUsed.push(legacyKey);
    }
  }

  return { legacyKeysUsed };
}

export function readTeaCodeEnvironmentValue(
  env: NodeJS.ProcessEnv,
  suffix: string,
): string | undefined {
  return env[`${PRODUCT_ENV_PREFIX}${suffix}`] ?? env[`${LEGACY_PRODUCT_ENV_PREFIX}${suffix}`];
}
