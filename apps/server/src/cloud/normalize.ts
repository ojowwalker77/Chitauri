/** Removes terminal/control bytes while preserving ordinary whitespace for later normalization. */
export function stripUnsafeControlCharacters(value: string): string {
  let normalized = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (
      (codePoint < 32 && codePoint !== 9 && codePoint !== 10 && codePoint !== 13) ||
      codePoint === 127
    ) {
      continue;
    }
    normalized += character;
  }
  return normalized;
}
