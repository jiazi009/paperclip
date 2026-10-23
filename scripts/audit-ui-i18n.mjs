import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const uiRoot = path.join(repoRoot, "ui", "src");
const scanRoots = [uiRoot];

// TypeScript 7 no longer exposes the JavaScript compiler API, so parse with the
// oxc parser that the UI's Vite toolchain already ships.
const uiRequire = createRequire(path.join(repoRoot, "ui", "package.json"));
const { parseSync } = await import(pathToFileURL(uiRequire.resolve("vite")).href);

const skippedFilePatterns = [/\.d\.ts$/, /\.test\.tsx?$/, /\.stories\.tsx?$/];
const translatableAttributes = /^(?:alt|aria-description|aria-label|buttonLabel|cancelLabel|confirmLabel|description|empty(?:Message|Text)|error(?:Message|Text)?|help(?:Text)?|hint|label|message|placeholder|subtitle|title|tooltip)$/i;
const uiObjectProperties = /^(?:ariaLabel|buttonLabel|cancelLabel|confirmLabel|description|empty(?:Message|Text)|error(?:Message|Text)?|help(?:Text)?|hint|label|message|placeholder|subtitle|title|tooltip)$/i;
const transparentWrappers = new Set([
  "ParenthesizedExpression",
  "TSAsExpression",
  "TSTypeAssertion",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
]);
const userFeedbackCalls = /(?:^|\.)(?:addToast|alert|confirm|prompt|showToast|toast)$|(?:^|\.)(?:toast|toasts)\.(?:error|info|success|warn|warning)$/;

function walkFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkFiles(absolutePath);
    return entry.isFile() && /\.tsx?$/.test(entry.name) ? [absolutePath] : [];
  });
}

function normalizeText(value) {
  return value.replace(/\s+/g, " ").trim();
}

function containsEnglishWords(value) {
  return /[A-Za-z]{2,}/.test(value.replace(/{{value\d+}}/g, ""));
}

function isNode(value) {
  return Boolean(value) && typeof value === "object" && typeof value.type === "string";
}

function children(node) {
  const result = [];
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

function quasiText(quasi) {
  return quasi.value.cooked ?? quasi.value.raw;
}

function expressionText(node) {
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral") {
    let result = quasiText(node.quasis[0]);
    for (let index = 1; index < node.quasis.length; index += 1) {
      result += `{{value${index}}}` + quasiText(node.quasis[index]);
    }
    return result;
  }
  return null;
}

function callName(expression) {
  if (expression.type === "Identifier") return expression.name;
  if (expression.type === "MemberExpression" && !expression.computed) return `${callName(expression.object)}.${expression.property.name}`;
  return "";
}

function propertyKeyText(source, key) {
  return source.slice(key.start, key.end);
}

function scanFile(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const { program } = parseSync(filePath, source, { lang: filePath.endsWith(".tsx") ? "tsx" : "ts", sourceType: "module" });
  const lineStarts = [0];
  for (let index = 0; index < source.length; index += 1) if (source[index] === "\n") lineStarts.push(index + 1);
  const findings = [];

  function lineAt(position) {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (lineStarts[middle] <= position) low = middle;
      else high = middle - 1;
    }
    return low + 1;
  }

  function add(kind, start, rawText) {
    const text = normalizeText(rawText);
    if (!text || !containsEnglishWords(text)) return;
    findings.push({
      file: path.relative(repoRoot, filePath),
      line: lineAt(start),
      kind,
      text,
    });
  }

  // Mirrors collectRenderedExpression() in ui/vite-static-i18n.ts: only the
  // literals the build transform actually wraps count as rendered UI copy.
  function collectExpression(node, kind) {
    if (node.type === "CallExpression") {
      const name = callName(node.callee);
      if (name === "t" || name.endsWith(".t")) return;
    }
    const text = expressionText(node);
    if (text !== null) {
      add(kind, node.start, text);
      return;
    }
    if (transparentWrappers.has(node.type)) {
      collectExpression(node.expression, kind);
    } else if (node.type === "ConditionalExpression") {
      collectExpression(node.consequent, kind);
      collectExpression(node.alternate, kind);
    } else if (node.type === "LogicalExpression") {
      if (node.operator !== "&&") collectExpression(node.left, kind);
      collectExpression(node.right, kind);
    } else if (node.type === "BinaryExpression" && node.operator === "+") {
      collectExpression(node.left, kind);
      collectExpression(node.right, kind);
    } else if (node.type === "ArrayExpression") {
      for (const element of node.elements) {
        if (element && element.type !== "SpreadElement") collectExpression(element, kind);
      }
    }
  }

  function visit(node, parent) {
    if (node.type === "JSXText") {
      const raw = source.slice(node.start, node.end);
      add("jsx-text", node.start + (raw.length - raw.trimStart().length), raw);
    }

    if (node.type === "JSXAttribute") {
      const attributeName = source.slice(node.name.start, node.name.end);
      if (translatableAttributes.test(attributeName) && node.value) {
        if (node.value.type === "Literal" && typeof node.value.value === "string") {
          add(`attribute:${attributeName}`, node.value.start, source.slice(node.value.start + 1, node.value.end - 1));
        } else if (node.value.type === "JSXExpressionContainer" && node.value.expression.type !== "JSXEmptyExpression") {
          collectExpression(node.value.expression, `attribute-expression:${attributeName}`);
        }
      }
    }

    if (
      node.type === "JSXExpressionContainer" &&
      node.expression.type !== "JSXEmptyExpression" &&
      parent?.type !== "JSXAttribute"
    ) {
      collectExpression(node.expression, "jsx-expression");
    }

    if (node.type === "Property" && parent?.type === "ObjectExpression" && !node.computed && !node.shorthand && !node.method && node.kind === "init") {
      const propertyName = propertyKeyText(source, node.key).replace(/["']/g, "");
      if (uiObjectProperties.test(propertyName)) {
        const text = expressionText(node.value);
        if (text !== null) add(`property:${propertyName}`, node.value.start, text);
      }
    }

    if (node.type === "AssignmentPattern" && node.left.type === "Identifier" && uiObjectProperties.test(node.left.name) && isParameterPosition(parent)) {
      const text = expressionText(node.right);
      if (text !== null) add(`parameter:${node.left.name}`, node.right.start, text);
    }

    // Explicit render-time translations must resolve in the catalogs too.
    if (node.type === "CallExpression" && callName(node.callee) === "translateUiLiteral") {
      const [argument] = node.arguments;
      const text = argument ? expressionText(argument) : null;
      if (text !== null) add("explicit:translateUiLiteral", argument.start, text);
    }

    if (node.type === "CallExpression" && userFeedbackCalls.test(callName(node.callee))) {
      for (const argument of node.arguments) {
        const text = expressionText(argument);
        if (text !== null) add(`feedback:${callName(node.callee)}`, argument.start, text);
      }
    }

    for (const child of children(node)) visit(child, node);
  }

  function isParameterPosition(parent) {
    return Boolean(parent) && (
      parent.type === "FunctionDeclaration" ||
      parent.type === "FunctionExpression" ||
      parent.type === "ArrowFunctionExpression" ||
      parent.type === "FormalParameter" ||
      parent.type === "TSParameterProperty"
    );
  }

  visit(program, null);
  return findings;
}

const files = scanRoots.flatMap(walkFiles)
  .filter((filePath) => !skippedFilePatterns.some((pattern) => pattern.test(filePath)))
  .sort();
const findings = files.flatMap(scanFile);
const unique = new Map();

for (const finding of findings) {
  const existing = unique.get(finding.text);
  if (existing) existing.occurrences.push({ file: finding.file, line: finding.line, kind: finding.kind });
  else unique.set(finding.text, { text: finding.text, occurrences: [{ file: finding.file, line: finding.line, kind: finding.kind }] });
}

const result = [...unique.values()].sort((left, right) => left.text.localeCompare(right.text));
// The build transform never rewrites object properties or parameter defaults:
// their values are often compared or sent to the API. They are listed for
// reference, but only count as translated once rendered via t() or
// translateUiLiteral(), so they are excluded from --check coverage.
const untransformedKind = /^(?:property|parameter):/;
const rendered = result.filter((entry) => entry.occurrences.some((occurrence) => !untransformedKind.test(occurrence.kind)));
const jsonMode = process.argv.includes("--json");
const checkMode = process.argv.includes("--check");

function flattenStrings(value, result = new Set()) {
  if (typeof value === "string") result.add(value);
  else if (value && typeof value === "object") {
    for (const nested of Object.values(value)) flattenStrings(nested, result);
  }
  return result;
}

if (checkMode) {
  const localeRoot = path.join(uiRoot, "i18n", "locales");
  const keyedEnglish = flattenStrings(JSON.parse(fs.readFileSync(path.join(localeRoot, "en.json"), "utf8")));
  const legacyChinese = {
    ...JSON.parse(fs.readFileSync(path.join(uiRoot, "i18n", "legacy-zh-CN.json"), "utf8")),
    ...JSON.parse(fs.readFileSync(path.join(uiRoot, "i18n", "legacy-zh-CN.overrides.json"), "utf8")),
  };
  const uncovered = rendered.filter(({ text }) => !keyedEnglish.has(text) && typeof legacyChinese[text] !== "string");
  const placeholderMismatches = Object.entries(legacyChinese).filter(([english, chinese]) => {
    const source = [...english.matchAll(/{{value\d+}}/g)].map((match) => match[0]).sort();
    const target = [...chinese.matchAll(/{{value\d+}}/g)].map((match) => match[0]).sort();
    return source.join("\0") !== target.join("\0");
  });

  if (uncovered.length || placeholderMismatches.length) {
    console.error(`i18n audit failed: ${uncovered.length} uncovered phrases, ${placeholderMismatches.length} placeholder mismatches.`);
    for (const entry of uncovered.slice(0, 100)) {
      const first = entry.occurrences[0];
      console.error(`${first.file}:${first.line}\t${entry.text}`);
    }
    for (const [english, chinese] of placeholderMismatches.slice(0, 20)) {
      console.error(`Placeholder mismatch: ${english} => ${chinese}`);
    }
    process.exit(1);
  }

  console.log(`i18n audit passed: ${files.length} TypeScript files, ${rendered.length} unique UI phrases, 0 uncovered.`);
  console.log(`${result.length - rendered.length} phrases appear only in object properties or parameter defaults; the build transform leaves these untranslated.`);
  process.exit(0);
}

if (jsonMode) {
  process.stdout.write(`${JSON.stringify({ files: files.length, occurrences: findings.length, phrases: result }, null, 2)}\n`);
} else {
  console.log(`Scanned ${files.length} TypeScript files: ${findings.length} occurrences, ${result.length} unique English UI phrases.`);
  for (const entry of result) {
    const first = entry.occurrences[0];
    console.log(`${first.file}:${first.line}\t${first.kind}\t${entry.text}`);
  }
}
