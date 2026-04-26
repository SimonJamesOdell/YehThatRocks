const fs = require("node:fs");
const path = require("node:path");

function readFileStrict(filePath, root = process.cwd()) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing file: ${path.relative(root, filePath)}`);
  }

  return fs.readFileSync(filePath, "utf8");
}

function assertContains(source, needle, description, failures) {
  if (!source.includes(needle)) {
    failures.push(`${description} (missing: ${needle})`);
  }
}

function assertNotContains(source, needle, description, failures) {
  if (source.includes(needle)) {
    failures.push(`${description} (unexpected: ${needle})`);
  }
}

function assertCssRuleContains(source, selector, needle, description, failures) {
  const selectorIndex = source.indexOf(selector);
  if (selectorIndex === -1) {
    failures.push(`${description} (missing selector: ${selector})`);
    return;
  }

  const blockStart = source.indexOf("{", selectorIndex);
  const blockEnd = blockStart === -1 ? -1 : source.indexOf("}", blockStart + 1);
  if (blockStart === -1 || blockEnd === -1) {
    failures.push(`${description} (invalid css block for selector: ${selector})`);
    return;
  }

  const block = source.slice(blockStart + 1, blockEnd);
  if (!block.includes(needle)) {
    failures.push(`${description} (missing in ${selector}: ${needle})`);
  }
}

function assertCssRuleNotContains(source, selector, needle, description, failures) {
  const selectorIndex = source.indexOf(selector);
  if (selectorIndex === -1) {
    failures.push(`${description} (missing selector: ${selector})`);
    return;
  }

  const blockStart = source.indexOf("{", selectorIndex);
  const blockEnd = blockStart === -1 ? -1 : source.indexOf("}", blockStart + 1);
  if (blockStart === -1 || blockEnd === -1) {
    failures.push(`${description} (invalid css block for selector: ${selector})`);
    return;
  }

  const block = source.slice(blockStart + 1, blockEnd);
  if (block.includes(needle)) {
    failures.push(`${description} (unexpected in ${selector}: ${needle})`);
  }
}

module.exports = {
  readFileStrict,
  assertContains,
  assertNotContains,
  assertCssRuleContains,
  assertCssRuleNotContains,
};
