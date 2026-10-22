import { describe, expect, it } from "vitest";

import { staticUiLocalization } from "./vite-static-i18n";

describe("staticUiLocalization", () => {
  it("localizes runtime section titles and action labels without changing config values", async () => {
    const plugin = staticUiLocalization();
    const source = `
      export function Settings() {
        return <AgentConfig
          sectionTitles={{ identity: "Agent identity", adapter: "Adapter" }}
          assignLabel="Assign Task" runLabel="Run now" chooseLabel="Choose manager…"
          adapterConfig={{ model: "gemini-4-argon-high", command: "codex" }}
        />;
      }
    `;
    const transform = plugin.transform;
    if (!transform) throw new Error("transform hook missing");
    const handler = typeof transform === "function" ? transform : transform.handler;
    const result = await handler.call({} as never, source, "/repo/ui/src/Settings.tsx", {} as never);
    const code = typeof result === "string" ? result : result?.code;
    for (const label of ["Agent identity", "Adapter", "Assign Task", "Run now", "Choose manager…"]) {
      expect(code).toContain(`__paperclipTranslateUiLiteral(${JSON.stringify(label)})`);
    }
    expect(code).toContain('adapterConfig={{ model: "gemini-4-argon-high", command: "codex" }}');
  });

  it("keeps editable values, model IDs and commands unchanged", async () => {
    const plugin = staticUiLocalization();
    const source = `
      export function ModelSettings({ agent }) {
        return <section>
          <label>Model</label>
          <input value="gemini-4-argon-high" placeholder="Choose a model" />
          <option value="grok-4.7-xhigh">Grok 4.7</option>
          <code>codex login --device-auth</code>
          <textarea>Do not translate my instructions</textarea>
          <h1>{agent.name}</h1>
        </section>;
      }
    `;
    const transform = plugin.transform;
    if (!transform) throw new Error("transform hook missing");
    const handler = typeof transform === "function" ? transform : transform.handler;
    const result = await handler.call({} as never, source, "/repo/ui/src/ModelSettings.tsx", {} as never);
    const code = typeof result === "string" ? result : result?.code;
    expect(code).toContain('value="gemini-4-argon-high"');
    expect(code).toContain('value="grok-4.7-xhigh"');
    expect(code).toContain('<code>codex login --device-auth</code>');
    expect(code).toContain('<textarea>Do not translate my instructions</textarea>');
    expect(code).toContain('{agent.name}');
    expect(code).toContain('__paperclipTranslateUiLiteral("Model")');
  });

  it("wraps static UI copy without touching dynamic user data", async () => {
    const plugin = staticUiLocalization();
    const source = `
      export function Card({ company }) {
        return <section title="Company settings"><h1>Welcome</h1><p>{company.name}</p></section>;
      }
    `;
    const transform = plugin.transform;
    if (!transform) throw new Error("transform hook missing");
    const handler = typeof transform === "function" ? transform : transform.handler;
    const result = await handler.call({} as never, source, "/repo/ui/src/Card.tsx", {} as never);
    const code = typeof result === "string" ? result : result?.code;

    expect(code).toContain('__paperclipTranslateUiLiteral("Company settings")');
    expect(code).toContain('__paperclipTranslateUiLiteral("Welcome")');
    expect(code).toContain("__paperclipUseUiLiteralLocale();");
    expect(code).toContain("{company.name}");
    expect(code).not.toContain("__paperclipTranslateUiLiteral(company.name)");
  });

  it("does not translate state or adapter identifiers used by rendered conditions", async () => {
    const plugin = staticUiLocalization();
    const source = `
      export function Wizard({ missionPath, adapterType }) {
        return <section>
          {missionPath === "questionnaire" && <p>Answer a few questions</p>}
          {missionPath === "direct" ? <p>Type it directly</p> : null}
          {adapterType === "codex_local" ? "Codex is ready" : "Choose an adapter"}
        </section>;
      }
    `;
    const transform = plugin.transform;
    if (!transform) throw new Error("transform hook missing");
    const handler = typeof transform === "function" ? transform : transform.handler;
    const result = await handler.call({} as never, source, "/repo/ui/src/Wizard.tsx", {} as never);
    const code = typeof result === "string" ? result : result?.code;

    expect(code).toContain('missionPath === "questionnaire"');
    expect(code).toContain('missionPath === "direct"');
    expect(code).toContain('adapterType === "codex_local"');
    expect(code).not.toContain('__paperclipTranslateUiLiteral("questionnaire")');
    expect(code).not.toContain('__paperclipTranslateUiLiteral("direct")');
    expect(code).not.toContain('__paperclipTranslateUiLiteral("codex_local")');
    expect(code).toContain('__paperclipTranslateUiLiteral("Answer a few questions")');
    expect(code).toContain('__paperclipTranslateUiLiteral("Type it directly")');
    expect(code).toContain('__paperclipTranslateUiLiteral("Codex is ready")');
    expect(code).toContain('__paperclipTranslateUiLiteral("Choose an adapter")');
  });
});
