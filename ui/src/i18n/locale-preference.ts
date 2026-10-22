export function matchSupportedLocale(candidate: string, supported: readonly string[]): string | null {
  const normalized = candidate.trim().replaceAll("_", "-").toLowerCase();
  const exact = supported.find((locale) => locale.toLowerCase() === normalized);
  if (exact) return exact;
  const chineseLocale = /^zh-(?:hant|tw|hk|mo)(?:-|$)/.test(normalized)
    ? "zh-TW"
    : /^(?:zh|zh-(?:hans|cn|sg)(?:-.*)?)$/.test(normalized) ? "zh-CN" : null;
  if (chineseLocale && supported.includes(chineseLocale)) return chineseLocale;
  const base = normalized.split("-")[0];
  return supported.find((locale) => locale.toLowerCase() === base) ?? null;
}

export function resolveLocalePreference(
  { persisted, defaultLocale, browserLanguages = [] }: {
    persisted?: string | null;
    defaultLocale?: string;
    browserLanguages?: readonly string[];
  },
  supported: readonly string[],
  fallback = "en",
): string {
  for (const candidate of [persisted, defaultLocale, ...browserLanguages]) {
    if (!candidate) continue;
    const match = matchSupportedLocale(candidate, supported);
    if (match) return match;
  }
  return fallback;
}
