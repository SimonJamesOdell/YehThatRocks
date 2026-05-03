const fs = require("node:fs");
const path = require("node:path");

function readFileStrict(filePath, root = process.cwd()) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing file: ${path.relative(root, filePath)}`);
  }

  return fs.readFileSync(filePath, "utf8");
}

function collectCssFiles(dirPath, acc = []) {
  if (!fs.existsSync(dirPath)) {
    return acc;
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      collectCssFiles(fullPath, acc);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".css")) {
      acc.push(fullPath);
    }
  }

  return acc;
}

function addFailure(failures, failure) {
  failures.push(failure);
}

function assertContains(source, needle, description, failures) {
  if (!source.includes(needle)) {
    addFailure(failures, `${description} (missing: ${needle})`);
  }
}

function assertNotContains(source, needle, description, failures) {
  if (source.includes(needle)) {
    addFailure(failures, `${description} (unexpected: ${needle})`);
  }
}

function assertMatches(source, pattern, description, failures) {
  if (!pattern.test(source)) {
    addFailure(failures, `${description} (pattern: ${pattern})`);
  }
}

function assertContainsEither(source, needles, description, failures) {
  if (!needles.some((needle) => source.includes(needle))) {
    addFailure(failures, `${description} (missing any of: ${needles.join(", ")})`);
  }
}

function assertContainsOneOf(source, needles, description, failures) {
  if (!needles.some((needle) => source.includes(needle))) {
    addFailure(failures, `${description} (missing one of: ${needles.join(" | ")})`);
  }
}

function assertInvariant(condition, description, details, failures) {
  if (condition) {
    console.log(`[ok] ${description}`);
    return;
  }

  addFailure(failures, {
    description,
    details: details ? String(details) : "",
  });
  console.error(`[fail] ${description}`);
  if (details) {
    console.error(`       ${details}`);
  }
}

function assertCssRuleContains(source, selector, needle, description, failures) {
  const selectorIndex = source.indexOf(selector);
  if (selectorIndex === -1) {
    addFailure(failures, `${description} (missing selector: ${selector})`);
    return;
  }

  const blockStart = source.indexOf("{", selectorIndex);
  const blockEnd = blockStart === -1 ? -1 : source.indexOf("}", blockStart + 1);
  if (blockStart === -1 || blockEnd === -1) {
    addFailure(failures, `${description} (invalid css block for selector: ${selector})`);
    return;
  }

  const block = source.slice(blockStart + 1, blockEnd);
  if (!block.includes(needle)) {
    addFailure(failures, `${description} (missing in ${selector}: ${needle})`);
  }
}

function assertCssRuleNotContains(source, selector, needle, description, failures) {
  const selectorIndex = source.indexOf(selector);
  if (selectorIndex === -1) {
    addFailure(failures, `${description} (missing selector: ${selector})`);
    return;
  }

  const blockStart = source.indexOf("{", selectorIndex);
  const blockEnd = blockStart === -1 ? -1 : source.indexOf("}", blockStart + 1);
  if (blockStart === -1 || blockEnd === -1) {
    addFailure(failures, `${description} (invalid css block for selector: ${selector})`);
    return;
  }

  const block = source.slice(blockStart + 1, blockEnd);
  if (block.includes(needle)) {
    addFailure(failures, `${description} (unexpected in ${selector}: ${needle})`);
  }
}

function assertFileDoesNotExist(filePath, description, failures, root = process.cwd()) {
  if (fs.existsSync(filePath)) {
    addFailure(failures, `${description} (file should not exist: ${path.relative(root, filePath)})`);
  }
}

function formatFailure(failure) {
  if (typeof failure === "string") {
    return failure;
  }

  if (failure && typeof failure === "object") {
    const description = typeof failure.description === "string" ? failure.description : "Invariant failed";
    const details = typeof failure.details === "string" ? failure.details : "";
    return details ? `${description} (${details})` : description;
  }

  return String(failure);
}

function finishInvariantCheck({ failures, failureHeader, successMessage }) {
  if (failures.length > 0) {
    console.error(failureHeader);
    for (const failure of failures) {
      console.error(`- ${formatFailure(failure)}`);
    }
    process.exit(1);
  }

  console.log(successMessage);
}

module.exports = {
  readFileStrict,
  collectCssFiles,
  assertContains,
  assertNotContains,
  assertMatches,
  assertContainsEither,
  assertContainsOneOf,
  assertInvariant,
  assertCssRuleContains,
  assertCssRuleNotContains,
  assertFileDoesNotExist,
  finishInvariantCheck,
};
