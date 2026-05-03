#!/usr/bin/env node

// Domain: Shell Decomposition
// Covers: verifies that shell-dynamic-core.tsx has been split into focused
// custom hooks — use-desktop-intro.ts, use-performance-metrics.ts,
// use-search-autocomplete.ts, use-chat-state.ts, use-playlist-rail.ts —
// and that each hook exports the expected API and contains the right logic.
// Run this after refactoring to confirm the decomposition is correct.

const path = require("node:path");
const {
  readFileStrict,
  assertContains,
  assertNotContains,
  finishInvariantCheck,
} = require("./invariants/helpers");

const ROOT = process.cwd();

const files = {
  shellDynamic: path.join(ROOT, "apps/web/components/shell-dynamic-core.tsx"),
  useDesktopIntro: path.join(ROOT, "apps/web/components/use-desktop-intro.ts"),
  usePerformanceMetrics: path.join(ROOT, "apps/web/components/use-performance-metrics.ts"),
  useSearchAutocomplete: path.join(ROOT, "apps/web/components/use-search-autocomplete.ts"),
  useChatState: path.join(ROOT, "apps/web/components/use-chat-state.ts"),
  usePlaylistRail: path.join(ROOT, "apps/web/components/use-playlist-rail.ts"),
};

function main() {
  const failures = [];

  const shellDynamicSource = readFileStrict(files.shellDynamic, ROOT);

  // ── Desktop Intro hook ──────────────────────────────────────────────────
  const useDesktopIntroSource = readFileStrict(files.useDesktopIntro, ROOT);

  assertContains(useDesktopIntroSource, "export function useDesktopIntro(", "useDesktopIntro is exported", failures);
  assertContains(useDesktopIntroSource, "const DESKTOP_INTRO_HOLD_MS =", "useDesktopIntro owns the intro timing constant", failures);
  assertContains(useDesktopIntroSource, "const DESKTOP_INTRO_MOVE_MS =", "useDesktopIntro owns the move timing constant", failures);
  assertContains(useDesktopIntroSource, "const DESKTOP_INTRO_REVEAL_MS =", "useDesktopIntro owns the reveal timing constant", failures);
  assertContains(useDesktopIntroSource, "startPreparedDesktopIntroSequence", "useDesktopIntro owns the prepared sequence starter", failures);
  assertContains(useDesktopIntroSource, "brandLogoTargetRef", "useDesktopIntro owns the brand-logo anchor ref", failures);
  assertContains(useDesktopIntroSource, "isDesktopIntroActive", "useDesktopIntro derives and returns active flag", failures);
  assertContains(useDesktopIntroSource, "\"--desktop-intro-dx\"", "useDesktopIntro owns the CSS variable for dx", failures);

  assertContains(shellDynamicSource, "useDesktopIntro(", "Shell imports and calls useDesktopIntro hook", failures);
  assertContains(shellDynamicSource, "from \"@/components/use-desktop-intro\"", "Shell imports useDesktopIntro from its own module", failures);

  // Timing constants must not be duplicated in shell core
  assertNotContains(shellDynamicSource, "const DESKTOP_INTRO_HOLD_MS =", "Shell core no longer defines DESKTOP_INTRO_HOLD_MS", failures);
  assertNotContains(shellDynamicSource, "const DESKTOP_INTRO_MOVE_MS =", "Shell core no longer defines DESKTOP_INTRO_MOVE_MS", failures);

  // ── Performance Metrics hook ─────────────────────────────────────────────
  const usePerformanceMetricsSource = readFileStrict(files.usePerformanceMetrics, ROOT);

  assertContains(usePerformanceMetricsSource, "export function usePerformanceMetrics(", "usePerformanceMetrics is exported", failures);
  assertContains(usePerformanceMetricsSource, "const PUBLIC_PERFORMANCE_POLL_MS =", "usePerformanceMetrics owns the poll interval constant", failures);
  assertContains(usePerformanceMetricsSource, "await fetch(\"/api/status/performance\"", "usePerformanceMetrics fetches from public performance endpoint", failures);
  assertContains(usePerformanceMetricsSource, "isPerformanceModalOpen", "usePerformanceMetrics manages modal open state", failures);
  assertContains(usePerformanceMetricsSource, "isPerformanceQuickLaunchVisible", "usePerformanceMetrics manages quick-launch visibility", failures);

  assertContains(shellDynamicSource, "usePerformanceMetrics(", "Shell imports and calls usePerformanceMetrics hook", failures);
  assertContains(shellDynamicSource, "from \"@/components/use-performance-metrics\"", "Shell imports usePerformanceMetrics from its own module", failures);

  // Poll constant and fetch must not be duplicated in shell core
  assertNotContains(shellDynamicSource, "const PUBLIC_PERFORMANCE_POLL_MS =", "Shell core no longer defines PUBLIC_PERFORMANCE_POLL_MS", failures);
  assertNotContains(shellDynamicSource, "await fetch(\"/api/status/performance\"", "Shell core no longer directly fetches performance metrics", failures);

  // ── Search Autocomplete hook ─────────────────────────────────────────────
  const useSearchAutocompleteSource = readFileStrict(files.useSearchAutocomplete, ROOT);

  assertContains(useSearchAutocompleteSource, "export function useSearchAutocomplete(", "useSearchAutocomplete is exported", failures);
  assertContains(useSearchAutocompleteSource, "searchComboboxRef", "useSearchAutocomplete owns the combobox ref", failures);
  assertContains(useSearchAutocompleteSource, "handleSearchInput", "useSearchAutocomplete exports handleSearchInput", failures);
  assertContains(useSearchAutocompleteSource, "handleSearchKeyDown", "useSearchAutocomplete exports handleSearchKeyDown", failures);
  assertContains(useSearchAutocompleteSource, "handleSuggestionClick", "useSearchAutocomplete exports handleSuggestionClick", failures);
  assertContains(useSearchAutocompleteSource, "/api/search/suggest", "useSearchAutocomplete fetches from the suggest API", failures);
  assertContains(useSearchAutocompleteSource, "suggestDebounceRef", "useSearchAutocomplete owns the debounce ref", failures);

  assertContains(shellDynamicSource, "useSearchAutocomplete(", "Shell imports and calls useSearchAutocomplete hook", failures);
  assertContains(shellDynamicSource, "from \"@/components/use-search-autocomplete\"", "Shell imports useSearchAutocomplete from its own module", failures);

  // Suggest fetch and debounce must not be in shell core
  assertNotContains(shellDynamicSource, "/api/search/suggest", "Shell core no longer directly calls the suggest API", failures);
  assertNotContains(shellDynamicSource, "suggestDebounceRef", "Shell core no longer owns the suggest debounce ref", failures);

  // ── Chat State hook ──────────────────────────────────────────────────────
  const useChatStateSource = readFileStrict(files.useChatState, ROOT);

  assertContains(useChatStateSource, "export function useChatState(", "useChatState is exported", failures);
  assertContains(useChatStateSource, "const globalEvents = new EventSource(\"/api/chat/stream?mode=global\");", "useChatState subscribes to global chat stream", failures);
  assertContains(useChatStateSource, "fetchWithAuthRetry(`/api/chat?", "useChatState loads chat via authenticated API call", failures);
  assertContains(useChatStateSource, "fetchWithAuthRetry(\"/api/chat\",", "useChatState posts chat via authenticated API call", failures);
  assertContains(useChatStateSource, "setChatMode(\"magazine\");", "useChatState keeps magazine mode selectable", failures);
  assertContains(shellDynamicSource, "setChatMode(\"online\")", "shell JSX keeps online chat mode tab selectable", failures);
  assertContains(useChatStateSource, "node.scrollTop = node.scrollHeight;", "useChatState auto-scrolls chat list on new message", failures);
  assertContains(useChatStateSource, "chatListRef", "useChatState owns the chat list scroll ref", failures);
  assertContains(useChatStateSource, "triggerChatTabFlash", "useChatState owns the chat-tab flash helper", failures);
  assertContains(useChatStateSource, "const latestMagazineTracks = useMemo(", "useChatState derives magazine track list", failures);

  assertContains(shellDynamicSource, "useChatState(", "Shell imports and calls useChatState hook", failures);
  assertContains(shellDynamicSource, "from \"@/components/use-chat-state\"", "Shell imports useChatState from its own module", failures);

  // SSE and chat fetch must not be duplicated in shell core
  assertNotContains(shellDynamicSource, "new EventSource(\"/api/chat/stream", "Shell core no longer directly opens chat SSE stream", failures);
  assertNotContains(shellDynamicSource, "fetchWithAuthRetry(`/api/chat?", "Shell core no longer directly loads chat history", failures);

  // ── Playlist Rail hook ───────────────────────────────────────────────────
  const usePlaylistRailSource = readFileStrict(files.usePlaylistRail, ROOT);

  assertContains(usePlaylistRailSource, "export function usePlaylistRail(", "usePlaylistRail is exported", failures);
  assertContains(usePlaylistRailSource, "fetchWithAuthRetry(`/api/playlists/", "usePlaylistRail loads playlist tracks via authenticated API", failures);
  assertContains(usePlaylistRailSource, "fetchWithAuthRetry(\"/api/playlists\"", "usePlaylistRail loads playlist summaries via authenticated API", failures);
  assertContains(usePlaylistRailSource, "draggedPlaylistTrackIndex", "usePlaylistRail manages drag state", failures);
  assertContains(usePlaylistRailSource, "playlistStackBodyRef", "usePlaylistRail owns the playlist body scroll ref", failures);
  assertContains(usePlaylistRailSource, "handleDeleteActivePlaylist", "usePlaylistRail exports delete-active-playlist handler", failures);
  assertContains(usePlaylistRailSource, "handleDeletePlaylistFromRail", "usePlaylistRail exports delete-from-rail handler", failures);
  assertContains(usePlaylistRailSource, "handleCreatePlaylistFromRail", "usePlaylistRail exports create-from-rail handler", failures);
  assertContains(usePlaylistRailSource, "handleAddToPlaylistFromWatchNext", "usePlaylistRail exports add-to-playlist handler", failures);

  assertContains(shellDynamicSource, "usePlaylistRail(", "Shell imports and calls usePlaylistRail hook", failures);
  assertContains(shellDynamicSource, "from \"@/components/use-playlist-rail\"", "Shell imports usePlaylistRail from its own module", failures);

  // Playlist fetch must not be duplicated in shell core
  assertNotContains(shellDynamicSource, "fetchWithAuthRetry(`/api/playlists/", "Shell core no longer directly fetches playlist tracks", failures);

  // ── General decomposition checks ─────────────────────────────────────────
  // Shell core must remain a thin orchestrator. Target under 4400 lines after
  // the five hook extractions (playlist rail, chat state, performance metrics,
  // search autocomplete, desktop intro). A follow-up extraction of
  // watch-next-rail will further reduce this.
  const lineCount = shellDynamicSource.split("\n").length;
  if (lineCount > 4400) {
    failures.push(`shell-dynamic-core.tsx is still too large (${lineCount} lines); target is under 4400 after decomposition`);
  }

  // Summary
  finishInvariantCheck({
    failures,
    failureHeader: "\n❌ Shell decomposition invariants FAILED:\n",
    successMessage: "✅ Shell decomposition invariants passed.",
  });
}

main();
