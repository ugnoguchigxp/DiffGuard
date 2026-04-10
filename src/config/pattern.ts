const normalizeForMatch = (value: string): string => {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
};

const globToRegExp = (pattern: string): RegExp => {
  const normalized = normalizeForMatch(pattern);
  let regex = "^";

  for (let index = 0; index < normalized.length; index += 1) {
    if (normalized.startsWith("**/", index)) {
      // `**/` should match zero or more directory segments.
      regex += "(?:[^/]+/)*";
      index += 2;
      continue;
    }

    if (normalized.startsWith("**", index)) {
      regex += ".*";
      index += 1;
      continue;
    }

    const char = normalized[index];
    if (!char) continue;

    if (char === "*") {
      regex += "[^/]*";
      continue;
    }

    if ("|\\{}()[]^$+?.-".includes(char)) {
      regex += `\\${char}`;
      continue;
    }

    regex += char;
  }

  return new RegExp(`${regex}$`);
};

export const matchesGlob = (value: string, pattern: string): boolean => {
  const normalizedValue = normalizeForMatch(value);
  const regex = globToRegExp(pattern);
  return regex.test(normalizedValue);
};

export const matchesAnyGlob = (value: string, patterns: string[]): boolean => {
  return patterns.some((pattern) => matchesGlob(value, pattern));
};

export const normalizePathForMatch = normalizeForMatch;
