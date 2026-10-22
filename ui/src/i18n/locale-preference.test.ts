import { describe, expect, it } from "vitest";
import { matchSupportedLocale, resolveLocalePreference } from "./locale-preference";

const supported = ["en", "zh-CN", "zh-TW"];

describe("locale preference", () => {
  it("keeps the user's choice above a deployment default", () => {
    expect(resolveLocalePreference({ persisted: "en", defaultLocale: "zh-CN", browserLanguages: ["zh-CN"] }, supported)).toBe("en");
  });

  it("uses a Chinese deployment default before an English browser", () => {
    expect(resolveLocalePreference({ defaultLocale: "zh-CN", browserLanguages: ["en-AU"] }, supported)).toBe("zh-CN");
  });

  it("ignores unsupported stored and deployment values", () => {
    expect(resolveLocalePreference({ persisted: "unknown", defaultLocale: "unknown", browserLanguages: ["fr", "zh-SG"] }, supported)).toBe("zh-CN");
  });

  it.each(["zh", "zh_CN", "zh-Hans", "zh-Hans-SG"])("matches Simplified Chinese %s", (locale) => {
    expect(matchSupportedLocale(locale, supported)).toBe("zh-CN");
  });

  it.each(["zh-TW", "zh-Hant", "zh-Hant-HK", "zh_HK"])("preserves Traditional Chinese %s", (locale) => {
    expect(matchSupportedLocale(locale, supported)).toBe("zh-TW");
  });

  it("uses English when no available language matches", () => {
    expect(resolveLocalePreference({ browserLanguages: ["fr"] }, supported)).toBe("en");
  });
});
