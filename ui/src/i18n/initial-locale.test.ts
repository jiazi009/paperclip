// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  window.localStorage.removeItem("paperclip.locale");
  vi.resetModules();
});

describe("initial UI locale", () => {
  it("starts in the configured deployment language", async () => {
    window.localStorage.clear();
    vi.stubEnv("VITE_DEFAULT_LOCALE", "zh-CN");
    vi.resetModules();
    const { i18n } = await import(".");
    expect(i18n.resolvedLanguage).toBe("zh-CN");
    expect(document.documentElement.lang).toBe("zh-CN");
  });

  it("keeps a saved English choice above the Chinese deployment default", async () => {
    window.localStorage.setItem("paperclip.locale", "en");
    vi.stubEnv("VITE_DEFAULT_LOCALE", "zh-CN");
    vi.resetModules();
    const { i18n } = await import(".");
    expect(i18n.resolvedLanguage).toBe("en");
  });

  it("still detects the browser language when storage access is blocked", async () => {
    vi.stubEnv("VITE_DEFAULT_LOCALE", "");
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => { throw new Error("Storage blocked"); });
    vi.spyOn(window.navigator, "languages", "get").mockReturnValue(["zh-Hans"]);
    vi.resetModules();
    const { i18n } = await import(".");
    expect(i18n.resolvedLanguage).toBe("zh-CN");
  });
});
