#!/usr/bin/env node

const path = require("node:path");
const { readFileStrict, assertContains, assertNotContains, finishInvariantCheck } = require("./lib/test-harness");

const ROOT = process.cwd();

const files = {
  overviewTab: path.join(ROOT, "apps/web/components/admin-dashboard-overview-tab.tsx"),
  panel: path.join(ROOT, "apps/web/components/admin-dashboard-panel.tsx"),
  editor: path.join(ROOT, "apps/web/lib/admin-traffic-editor.ts"),
  route: path.join(ROOT, "apps/web/app/api/admin/dashboard/traffic-adjustments/route.ts"),
};

function main() {
  const failures = [];

  const overviewTabSource = readFileStrict(files.overviewTab, ROOT);
  const panelSource = readFileStrict(files.panel, ROOT);
  const editorSource = readFileStrict(files.editor, ROOT);
  const routeSource = readFileStrict(files.route, ROOT);

  // ── Overview tab: the Edit traffic button must exist and be wired. ──────
  assertContains(overviewTabSource, '"Edit traffic"', "Overview tab renders the Edit traffic button label", failures);
  assertContains(overviewTabSource, "onClick={onToggleTrafficEdit}", "Overview tab wires the Edit traffic button to onToggleTrafficEdit", failures);
  assertContains(overviewTabSource, 'data-testid="traffic-edit-toggle"', "Overview tab tags the Edit traffic button for tests", failures);
  assertContains(overviewTabSource, "aria-pressed={trafficEditEnabled}", "Overview tab exposes traffic edit pressed state for a11y/tests", failures);
  assertContains(overviewTabSource, "onAdjustTrafficPoint", "Overview tab receives the traffic edit submit callback", failures);

  // ── Panel: state, wiring and persistence. ────────────────────────────────
  assertContains(panelSource, "const [trafficEditEnabled, setTrafficEditEnabled] = useState(false);", "Panel owns the traffic edit toggle state", failures);
  assertContains(panelSource, "trafficEditEnabled={trafficEditEnabled}", "Panel passes traffic edit state to the overview tab", failures);
  assertContains(panelSource, '"/api/admin/dashboard/traffic-adjustments"', "Panel persists edits through the traffic-adjustments route", failures);
  assertContains(panelSource, "await loadOverview(true);", "Panel force-refreshes overview after a successful traffic edit", failures);

  // ── Route: validation and edit application. ──────────────────────────────
  assertContains(routeSource, "applyTrafficEdit", "Traffic-adjustments route applies the edit to source data", failures);
  assertContains(routeSource, "patchCachedTrafficValue", "Traffic-adjustments route patches the cached graph value", failures);

  // ── Editor: the two bugs that previously broke editing must stay fixed. ──
  assertContains(editorSource, "export async function applyTrafficEdit", "Editor exposes applyTrafficEdit", failures);
  assertContains(editorSource, 'firstDayPredicate(granularity, "new", bucketStartIso, "ev")', "New-visitor read scopes its first-day predicate to the ev alias", failures);
  assertContains(editorSource, 'firstDayPredicate(granularity, "return", bucketStartIso, "ev")', "Return-visit read scopes its first-day predicate to the ev alias", failures);
  assertContains(editorSource, 'alias: "fs" | "ev" = "fs"', "Editor first-day predicate takes an explicit scope alias", failures);
  assertNotContains(
    editorSource,
    "const rows = await prisma.$queryRawUnsafe<CountRow[]>(sql).catch(() => []);",
    "Editor does not swallow current-value read errors",
    failures,
  );

  finishInvariantCheck({
    failures,
    failureHeader: "Traffic editor invariant check failed.",
    successMessage: "Traffic editor invariant check passed.",
  });
}

main();
