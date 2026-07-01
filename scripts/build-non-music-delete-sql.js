const fs = require("node:fs");
const path = require("node:path");
const { parseArg } = require("./lib/cli");
const { sanitizeSqlString, buildDeleteSql } = require("./lib/delete-sql-builder");

function main() {
  const inputPath = parseArg("input", "");
  const outputPathArg = parseArg("output", "");

  if (!inputPath) {
    throw new Error("Usage: node scripts/build-non-music-delete-sql.js --input=logs/non-music-approved-ids.txt [--output=logs/non-music-approved-vps-delete.sql]");
  }

  const resolvedInput = path.resolve(process.cwd(), inputPath);
  if (!fs.existsSync(resolvedInput)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  const lines = fs.readFileSync(resolvedInput, "utf8").split(/\r?\n/);
  const ids = [...new Set(lines.map((line) => line.trim()).filter((line) => /^[A-Za-z0-9_-]{11}$/.test(line)))];

  if (ids.length === 0) {
    throw new Error("No valid 11-char video IDs found in input file.");
  }

  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const resolvedOutput = outputPathArg
    ? path.resolve(process.cwd(), outputPathArg)
    : path.resolve(process.cwd(), `logs/non-music-approved-${stamp}-vps-delete.sql`);

  fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });
  fs.writeFileSync(resolvedOutput, buildDeleteSql(ids, now, `ids file: ${inputPath}`));

  console.log(`Input IDs: ${ids.length}`);
  console.log(`Output SQL: ${path.relative(process.cwd(), resolvedOutput)}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}