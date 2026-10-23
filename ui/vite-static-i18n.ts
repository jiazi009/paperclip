import path from "node:path";
import { parseSync, type Plugin } from "vite";
import { decodeJsxEntities } from "./vite-jsx-entities";

// The static localization pass walks the ESTree/oxc AST that Vite already ships
// (TypeScript 7 no longer exposes the JavaScript compiler API).
type Node = { type: string; start: number; end: number; [key: string]: unknown };

const helper = "__paperclipTranslateUiLiteral";
const localeHook = "__paperclipUseUiLiteralLocale";
const translatableAttributes = /^(?:alt|aria-description|aria-label|buttonLabel|cancelLabel|confirmLabel|description|empty(?:Message|Text)|error(?:Message|Text)?|help(?:Text)?|hint|label|message|placeholder|subtitle|title|tooltip)$/i;
const userFeedbackCalls = /(?:^|\.)(?:addToast|alert|confirm|prompt|showToast|toast)$|(?:^|\.)(?:toast|toasts)\.(?:error|info|success|warn|warning)$/;
const skippedElements = new Set(["code", "kbd", "noscript", "pre", "script", "style", "textarea"]);
const transparentWrappers = new Set([
  "ParenthesizedExpression",
  "TSAsExpression",
  "TSTypeAssertion",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
]);

function isNode(value: unknown): value is Node {
  return Boolean(value) && typeof value === "object" && typeof (value as Node).type === "string";
}

function children(node: Node): Node[] {
  const result: Node[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === "parent") continue;
    if (Array.isArray(value)) {
      for (const item of value) if (isNode(item)) result.push(item);
    } else if (isNode(value)) {
      result.push(value);
    }
  }
  return result.sort((left, right) => left.start - right.start);
}

function callName(expression: Node): string {
  if (expression.type === "Identifier") return expression.name as string;
  if (expression.type === "MemberExpression" && !expression.computed) {
    return `${callName(expression.object as Node)}.${(expression.property as Node).name as string}`;
  }
  return "";
}

function isTranslationCall(node: Node) {
  if (node.type !== "CallExpression") return false;
  const name = callName(node.callee as Node);
  return name === "t" || name.endsWith(".t") || name === helper;
}

function quasiText(quasi: Node) {
  const value = quasi.value as { cooked: string | null; raw: string };
  return value.cooked ?? value.raw;
}

function expressionText(node: Node): string | null {
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral") {
    const quasis = node.quasis as Node[];
    let value = quasiText(quasis[0]);
    for (let index = 1; index < quasis.length; index += 1) {
      value += `{{value${index}}}${quasiText(quasis[index])}`;
    }
    return value;
  }
  return null;
}

function containsEnglish(value: string) {
  return /[A-Za-z]{2,}/.test(value.replace(/{{value\d+}}/g, ""));
}

// Matches the whitespace folding performed for JSX text by React's compiler.
function cleanJsxText(value: string) {
  const lines = value.replace(/\r\n?/g, "\n").split("\n");
  let lastNonEmptyLine = 0;
  for (let index = 0; index < lines.length; index += 1) {
    if (/[^ \t]/.test(lines[index])) lastNonEmptyLine = index;
  }
  let result = "";
  for (let index = 0; index < lines.length; index += 1) {
    let line = lines[index].replace(/\t/g, " ");
    if (index !== 0) line = line.replace(/^ +/, "");
    if (index !== lines.length - 1) line = line.replace(/ +$/, "");
    if (!line) continue;
    result += line;
    if (index !== lastNonEmptyLine) result += " ";
  }
  return result;
}

export function staticUiLocalization(): Plugin {
  return {
    name: "paperclip-static-ui-localization",
    enforce: "pre",
    transform(source, rawId) {
      const id = rawId.split("?", 1)[0];
      const normalizedId = id.split(path.sep).join("/");
      if (
        !/\.tsx?$/.test(id) ||
        !normalizedId.includes("/src/") ||
        normalizedId.includes("/src/i18n/") ||
        /(?:\.test|\.stories)\.tsx?$/.test(id)
      ) return null;

      const parsed = parseSync(id, source, { lang: id.endsWith(".tsx") ? "tsx" : "ts", sourceType: "module" });
      const program = parsed.program as unknown as Node;
      const replacements = new Map<number, { end: number; value: string }>();
      const componentBodies = new Set<number>();
      const ancestors: Node[] = [];

      function isInsideSkippedElement() {
        return ancestors.some((ancestor) => {
          if (ancestor.type !== "JSXElement") return false;
          const name = (ancestor.openingElement as Node).name as Node;
          return skippedElements.has(source.slice(name.start, name.end).toLowerCase());
        });
      }

      function markComponentOwner() {
        for (let index = ancestors.length - 1; index >= 0; index -= 1) {
          const current = ancestors[index];
          if (current.type === "FunctionDeclaration") {
            const name = (current.id as Node | null)?.name as string | undefined;
            if (name && /^[A-Z]/.test(name)) {
              componentBodies.add((current.body as Node).start + 1);
              return;
            }
            continue;
          }
          if (current.type !== "ArrowFunctionExpression" && current.type !== "FunctionExpression") continue;
          const body = current.body as Node;
          if (body.type !== "BlockStatement") continue;
          let parentIndex = index - 1;
          if (ancestors[parentIndex]?.type === "CallExpression") parentIndex -= 1;
          const parent = ancestors[parentIndex];
          const parentName = parent?.type === "VariableDeclarator" ? (parent.id as Node) : null;
          if (parentName?.type === "Identifier" && /^[A-Z]/.test(parentName.name as string)) {
            componentBodies.add(body.start + 1);
            return;
          }
        }
      }

      function addExpression(node: Node) {
        const text = expressionText(node);
        if (text === null || !containsEnglish(text)) return;
        replacements.set(node.start, {
          end: node.end,
          value: `${helper}(${source.slice(node.start, node.end)})`,
        });
        markComponentOwner();
      }

      function collectRenderedExpression(node: Node) {
        if (isTranslationCall(node)) return;
        if (expressionText(node) !== null) {
          addExpression(node);
          return;
        }
        if (node.type === "JSXElement" || node.type === "JSXFragment") return;
        if (transparentWrappers.has(node.type)) {
          collectRenderedExpression(node.expression as Node);
          return;
        }
        if (node.type === "ConditionalExpression") {
          collectRenderedExpression(node.consequent as Node);
          collectRenderedExpression(node.alternate as Node);
          return;
        }
        if (node.type === "LogicalExpression") {
          if (node.operator !== "&&") collectRenderedExpression(node.left as Node);
          collectRenderedExpression(node.right as Node);
          return;
        }
        if (node.type === "BinaryExpression" && node.operator === "+") {
          collectRenderedExpression(node.left as Node);
          collectRenderedExpression(node.right as Node);
          return;
        }
        if (node.type === "ArrayExpression") {
          for (const element of node.elements as Array<Node | null>) {
            if (element && element.type !== "SpreadElement") collectRenderedExpression(element);
          }
        }
      }

      function visit(node: Node) {
        if (node.type === "CallExpression") {
          if (isTranslationCall(node)) return;
          if (userFeedbackCalls.test(callName(node.callee as Node))) {
            for (const argument of node.arguments as Node[]) addExpression(argument);
          }
        }

        if (node.type === "JSXText" && !isInsideSkippedElement()) {
          // Like TypeScript's getStart(), leading whitespace stays outside the replacement.
          const raw = source.slice(node.start, node.end);
          const start = node.start + (raw.length - raw.trimStart().length);
          const text = cleanJsxText(decodeJsxEntities(source.slice(start, node.end)));
          if (containsEnglish(text)) {
            replacements.set(start, {
              end: node.end,
              value: `{${helper}(${JSON.stringify(text)})}`,
            });
            markComponentOwner();
          }
        }

        if (node.type === "JSXAttribute") {
          const nameNode = node.name as Node;
          const name = source.slice(nameNode.start, nameNode.end);
          const value = node.value as Node | null;
          if (translatableAttributes.test(name) && value) {
            if (value.type === "Literal" && typeof value.value === "string") {
              const text = decodeJsxEntities(source.slice(value.start + 1, value.end - 1));
              if (containsEnglish(text)) {
                replacements.set(value.start, {
                  end: value.end,
                  value: `{${helper}(${JSON.stringify(text)})}`,
                });
                markComponentOwner();
              }
            } else if (value.type === "JSXExpressionContainer" && (value.expression as Node).type !== "JSXEmptyExpression") {
              ancestors.push(node, value);
              collectRenderedExpression(value.expression as Node);
              ancestors.length -= 2;
            }
          }
        } else if (
          node.type === "JSXExpressionContainer" &&
          (node.expression as Node).type !== "JSXEmptyExpression" &&
          ancestors[ancestors.length - 1]?.type !== "JSXAttribute"
        ) {
          ancestors.push(node);
          collectRenderedExpression(node.expression as Node);
          ancestors.pop();
        }

        ancestors.push(node);
        for (const child of children(node)) visit(child);
        ancestors.pop();
      }

      visit(program);
      if (!replacements.size) return null;

      for (const position of componentBodies) {
        replacements.set(position, { end: position, value: `\n${localeHook}();` });
      }

      let code = source;
      for (const [start, replacement] of [...replacements].sort((left, right) => right[0] - left[0])) {
        code = `${code.slice(0, start)}${replacement.value}${code.slice(replacement.end)}`;
      }
      code = `import { translateUiLiteral as ${helper}, useUiLiteralLocale as ${localeHook} } from "@/i18n/LegacyLiteralLocalizer";\n${code}`;
      return { code, map: null };
    },
  };
}
