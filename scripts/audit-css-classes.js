/**
 * Dead CSS class audit — reads a CSS file, extracts all class selectors,
 * and checks if they appear in any TSX/TS/JS source file.
 *
 * Usage: node scripts/audit-css-classes.js apps/web/app/styles/player-chrome.css
 */
const fs = require("node:fs");
const path = require("node:path");

const cssFile = process.argv[2];
if (!cssFile) {
  console.error("Usage: node audit-css-classes.js <path-to-css-file>");
  process.exit(1);
}

const css = fs.readFileSync(cssFile, "utf8");

// Extract class selectors
const classPattern = /\.([a-zA-Z_][\w-]*)/g;
const seen = new Set();
let match;
while ((match = classPattern.exec(css)) !== null) {
  seen.add(match[1]);
}

const skipWords = new Set(["a", "b", "i", "x", "y", "on", "to", "in", "is", "lg", "md", "sm", "xl", "xs", "px", "em", "ms"]);
const classes = [...seen].filter((c) => c.length >= 3 && !skipWords.has(c));
console.log(`Found ${classes.length} unique class names in ${path.basename(cssFile)}`);

// Collect all source files
const sourceDir = path.resolve(__dirname, "..", "apps", "web");

function collectFiles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next" || entry.name === ".turbo") continue;
      collectFiles(full, acc);
    } else if (/\.(tsx?|jsx?|mjs)$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

const sourceFiles = collectFiles(sourceDir);
console.log(`Scanning ${sourceFiles.length} source files...`);

// Read all source files into one big searchable buffer
// But reading them all at once might be too memory-intensive
// Instead, search each class across files

const dead = [];
const alive = [];

for (let ci = 0; ci < classes.length; ci++) {
  const cls = classes[ci];
  let found = false;

  for (const file of sourceFiles) {
    try {
      const content = fs.readFileSync(file, "utf8");
      if (content.includes(cls)) {
        found = true;
        break;
      }
    } catch {
      // skip unreadable files
    }
  }

  if (found) {
    alive.push(cls);
  } else {
    dead.push(cls);
  }

  if ((ci + 1) % 10 === 0) {
    console.log(`  ${ci + 1}/${classes.length}...`);
  }
}

console.log(`\nDead (no source match): ${dead.length}`);
console.log(`Alive (found in source): ${alive.length}`);

if (dead.length > 0) {
  console.log("\n=== Potentially dead classes ===");
  for (const cls of dead.sort()) {
    console.log(`  .${cls}`);
  }
}

const reportPath = path.resolve(__dirname, "..", "dead-css-report.txt");
const report = [
  `CSS dead-class audit: ${path.basename(cssFile)}`,
  `Total unique classes: ${classes.length}`,
  `Dead (no source match): ${dead.length}`,
  `Alive (found in source): ${alive.length}`,
  "",
  "=== Potentially dead classes ===",
  ...dead.sort().map((c) => `  .${c}`),
].join("\n");

fs.writeFileSync(reportPath, report);
console.log(`\nReport written to ${reportPath}`);
