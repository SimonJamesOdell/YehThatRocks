#!/usr/bin/env node

/**
 * OG share invariant check.
 *
 * Guards the social-share Open Graph contract for yehthatrocks.com:
 *
 *  1. Homepage `?v=<id>` shares use the real YouTube video thumbnail
 *     (i.ytimg.com hqdefault + maxresdefault), never the generated card.
 *  2. The base homepage URL (no ?v=, or an unknown id) uses the generated
 *     branded "home" card via `/og?type=home`.
 *  3. The `/og` endpoint can actually render every card type. This is the
 *     functional guard against the satori layout regression where a `<div>`
 *     with more than one child lacks an explicit `display: flex` and the
 *     endpoint dies with a 503 (no Facebook preview thumbnail).
 */

const fs = require("node:fs");
const path = require("node:path");

const {
  readFileStrict,
  assertContains,
  assertNotContains,
  finishInvariantCheck,
} = require("./lib/test-harness");

const ROOT = process.cwd();

const PAGE_FILE = path.join(ROOT, "apps/web/app/(shell)/page.tsx");
const OG_ROUTE_FILE = path.join(ROOT, "apps/web/app/og/route.tsx");

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * The route imports project-local modules (e.g. the embedded logo asset via
 * `@/lib/og-logo`). Node cannot resolve the `@/` alias, so transpile each such
 * module into the temp dir and rewrite its `require("@/lib/...")` to an
 * absolute path before the route is required.
 */
function transpileLocalAliasImports(routeJs, tmpDir, ts, failures) {
  const aliasImportPattern = /require\("@\/lib\/([^"]+)"\)/g;
  let resolved = routeJs;
  let match;

  while ((match = aliasImportPattern.exec(routeJs)) !== null) {
    const moduleName = match[1];
    const sourcePath = path.join(ROOT, "apps", "web", "lib", `${moduleName}.ts`);

    if (!fs.existsSync(sourcePath)) {
      failures.push(`OG route imports a missing local module: @/lib/${moduleName}`);
      continue;
    }

    try {
      const moduleSource = fs.readFileSync(sourcePath, "utf8");
      const moduleJs = ts.transpileModule(moduleSource, {
        fileName: `${moduleName}.ts`,
        compilerOptions: {
          jsx: ts.JsxEmit.ReactJSX,
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          esModuleInterop: true,
        },
      }).outputText;

      const moduleFile = path.join(tmpDir, `${moduleName}.js`);
      fs.writeFileSync(moduleFile, moduleJs);
      resolved = resolved.split(match[0]).join(`require(${JSON.stringify(moduleFile)})`);
    } catch (err) {
      failures.push(`Failed to transpile @/lib/${moduleName}: ${err && err.message ? err.message : err}`);
    }
  }

  return resolved;
}

/**
 * Transpile the real OG route and render every card type, asserting each one
 * produces a valid PNG. Runs the actual ImageResponse/satori pipeline, so it
 * fails if any card component violates satori's layout rules again.
 */
async function renderEveryOgCard(failures) {
  let ts;
  try {
    ts = require("typescript");
  } catch (err) {
    failures.push(`TypeScript is required to render OG cards (${err && err.message ? err.message : err})`);
    return;
  }

  const source = readFileStrict(OG_ROUTE_FILE, ROOT);

  let js;
  try {
    js = ts.transpileModule(source, {
      fileName: "route.tsx",
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText;
  } catch (err) {
    failures.push(`Failed to transpile OG route (${err && err.message ? err.message : err})`);
    return;
  }

  // Write inside apps/web so require() resolves react/next from the root
  // node_modules by walking up the tree.
  const tmpDir = fs.mkdtempSync(path.join(ROOT, "apps", "web", ".og-invariant-"));
  const tmpFile = path.join(tmpDir, "route.js");

  // Resolve the route's @/lib/* imports before requiring it.
  js = transpileLocalAliasImports(js, tmpDir, ts, failures);

  try {
    fs.writeFileSync(tmpFile, js);

    const mod = require(tmpFile);
    if (typeof mod.GET !== "function") {
      failures.push("OG route has no exported GET handler");
      return;
    }

    const cases = [
      { name: "home (base URL)", url: "https://yehthatrocks.com/og?type=home" },
      { name: "video", url: "https://yehthatrocks.com/og?type=video&artist=Metallica&title=One&genre=Thrash" },
      { name: "artist", url: "https://yehthatrocks.com/og?type=artist&name=Metallica&genre=Thrash" },
      { name: "genre", url: "https://yehthatrocks.com/og?type=genre&name=Doom%20Metal" },
      { name: "magazine", url: "https://yehthatrocks.com/og?type=magazine&title=Hello&kicker=News" },
      { name: "default (video)", url: "https://yehthatrocks.com/og" },
    ];

    for (const c of cases) {
      try {
        const res = await mod.GET(new Request(c.url));
        const buf = Buffer.from(await res.arrayBuffer());
        const contentType = res.headers.get("content-type") || "";
        const validPng =
          res.status === 200
          && contentType.startsWith("image/png")
          && buf.length > 0
          && PNG_SIGNATURE.every((byte, index) => buf[index] === byte);

        if (!validPng) {
          failures.push(
            `OG card "${c.name}" failed to render (status=${res.status}, type=${contentType}, bytes=${buf.length})`,
          );
        }
      } catch (err) {
        failures.push(
          `OG card "${c.name}" threw while rendering: ${err && err.message ? err.message : err}`,
        );
      }
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function main() {
  const failures = [];

  const pageSource = readFileStrict(PAGE_FILE, ROOT);
  const routeSource = readFileStrict(OG_ROUTE_FILE, ROOT);

  // ── Homepage share metadata contract ─────────────────────────────────────
  assertContains(
    pageSource,
    'buildOgImageUrl({ type: "home" })',
    "Homepage base URL uses the generated home card",
    failures,
  );
  assertContains(
    pageSource,
    "i.ytimg.com/vi/",
    "Homepage ?v= share uses the real YouTube thumbnail",
    failures,
  );
  assertContains(
    pageSource,
    "hqdefault.jpg",
    "Homepage ?v= share includes the hqdefault thumbnail",
    failures,
  );
  assertContains(
    pageSource,
    "maxresdefault.jpg",
    "Homepage ?v= share includes the maxresdefault thumbnail",
    failures,
  );
  assertNotContains(
    pageSource,
    'buildOgImageUrl({ type: "video"',
    "Homepage ?v= share no longer uses the generated video card",
    failures,
  );

  // ── OG route wiring contract ─────────────────────────────────────────────
  assertContains(routeSource, "function OgHome(", "OG route defines the home card", failures);
  assertContains(routeSource, 'case "home":', "OG route wires the home card type", failures);
  assertContains(routeSource, "<OgHome />", "OG route renders the home card", failures);

  // ── Functional render contract ───────────────────────────────────────────
  await renderEveryOgCard(failures);

  finishInvariantCheck({
    failures,
    failureHeader: "OG share invariant check failed.",
    successMessage: "OG share invariant check passed.",
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
