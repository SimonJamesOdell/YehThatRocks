#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();

const files = {
  packageJson: path.join(ROOT, "package.json"),
  editor: path.join(ROOT, "apps/web/components/playlist-editor.tsx"),
  editorApi: path.join(ROOT, "apps/web/app/api/playlists/[id]/items/route.ts"),
  schemas: path.join(ROOT, "apps/web/lib/api-schemas.ts"),
  data: path.join(ROOT, "apps/web/lib/catalog-data.ts"),
  addButton: path.join(ROOT, "apps/web/components/add-to-playlist-button.tsx"),
  shell: path.join(ROOT, "apps/web/components/shell-dynamic.tsx"),
  player: path.join(ROOT, "apps/web/components/player-experience.tsx"),
  css: path.join(ROOT, "apps/web/app/globals.css"),
};

function read(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing file: ${path.relative(ROOT, filePath)}`);
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
    failures.push(`${description} (forbidden: ${needle})`);
  }
}

function assertMatches(source, pattern, description, failures) {
  if (!pattern.test(source)) {
    failures.push(`${description} (pattern: ${pattern})`);
  }
}

function main() {
  const failures = [];

  const packageJsonSource = read(files.packageJson);
  const editorSource = read(files.editor);
  const editorApiSource = read(files.editorApi);
  const schemasSource = read(files.schemas);
  const dataSource = read(files.data);
  const addButtonSource = read(files.addButton);
  const shellSource = read(files.shell);
  const playerSource = read(files.player);
  const cssSource = read(files.css);

  // pickColumn ordering invariant: must iterate priority names first, not DB columns.
  // If this regresses to iterating columns first, sort_order is never selected (id wins)
  // and every reorder call silently returns null (no-op 404).
  assertContains(dataSource, "for (const name of names)", "pickColumn iterates priority names first, not DB columns", failures);

  // Playlist rail concurrency invariant: must use a sequence counter, not a boolean
  // in-flight lock. The lock approach blocks rapid clicks; the sequence counter lets every
  // click fire immediately and discards stale out-of-order responses.
  assertNotContains(shellSource, "isPlaylistReorderPending", "Playlist rail does not use blocking in-flight lock for reorder", failures);
  assertContains(shellSource, "const reorderSeqRef = useRef(0);", "Playlist rail uses sequence counter for concurrent reorder safety", failures);
  assertContains(shellSource, "if (seq < reorderSeqRef.current)", "Playlist rail discards stale out-of-order reorder responses", failures);

  // Playlist rail load effect must NOT include searchParamsKey. Including it caused the
  // rail to fully reload on every autoplay advance (because ?v= changes each track).
  assertContains(
    shellSource,
    "}, [activePlaylistId, fetchWithAuthRetry, pathname, playlistRefreshTick, rightRailMode]);",
    "Playlist rail load effect omits searchParamsKey to prevent autoplay-triggered reloads",
    failures,
  );

  // API and schema invariants for playlist item remove/reorder.
  assertContains(schemasSource, "removePlaylistItemSchema", "Remove playlist item schema exists", failures);
  assertContains(schemasSource, "reorderPlaylistItemsSchema", "Reorder playlist items schema exists", failures);
  assertContains(editorApiSource, "export async function DELETE", "Playlist items route supports DELETE", failures);
  assertContains(editorApiSource, "export async function PATCH", "Playlist items route supports PATCH reorder", failures);
  assertContains(editorApiSource, "removePlaylistItem(", "Playlist items route calls removePlaylistItem", failures);
  assertContains(editorApiSource, "reorderPlaylistItems(", "Playlist items route calls reorderPlaylistItems", failures);
  assertContains(dataSource, "export async function removePlaylistItem", "Data layer removePlaylistItem exists", failures);
  assertContains(dataSource, "export async function reorderPlaylistItems", "Data layer reorderPlaylistItems exists", failures);

  // Playlist editor invariants.
  assertContains(editorSource, "draggable={isAuthenticated && !isPending && removingIndex === null}", "Playlist rows are draggable", failures);
  assertContains(editorSource, "onDrop={(event) => handleDrop(index, event)}", "Playlist rows support drop handler", failures);
  assertContains(editorSource, "method: \"PATCH\"", "Playlist editor persists reorder with PATCH", failures);
  assertContains(editorSource, "method: \"DELETE\"", "Playlist editor supports per-track delete", failures);
  assertContains(editorSource, "className=\"favouritesDeleteButton playlistEditorTrackDelete\"", "Playlist editor remove button uses fixed-right class", failures);
  assertNotContains(editorSource, "<p>{video.channelTitle}</p>", "Playlist editor does not show channel subtitle", failures);

  // Card add-to-playlist invariants (silent status + stable label + disabled-after-add).
  assertContains(addButtonSource, "setIsAdded(true);", "Add-to-playlist button marks successful add state", failures);
  assertContains(addButtonSource, "disabled={isPending || isAdded}", "Add-to-playlist button disables during pending or after add", failures);
  assertContains(addButtonSource, "+ Playlist", "Add-to-playlist button keeps fixed label text", failures);
  assertNotContains(addButtonSource, "{isPending ? \"...\" : \"+ Playlist\"}", "Add-to-playlist button avoids loading ellipsis label", failures);
  assertNotContains(addButtonSource, "setMessage(", "Add-to-playlist button has no inline status messages", failures);
  assertContains(addButtonSource, "const autoPlaylistName =", "Add-to-playlist auto-creates playlist when none exist", failures);
  assertContains(addButtonSource, "dispatchAppEvent(EVENT_NAMES.PLAYLISTS_UPDATED, null)", "Add-to-playlist dispatches playlist refresh event", failures);
  assertContains(addButtonSource, "const router = useRouter();", "Add-to-playlist button can update route state", failures);
  assertContains(addButtonSource, "const searchParams = useSearchParams();", "Add-to-playlist button reads current route params", failures);
  assertContains(addButtonSource, "params.set(\"pl\", playlistId);", "Auto-created playlist is set active in URL params", failures);
  assertContains(addButtonSource, "router.replace(query ? `/?${query}` : \"/\");", "Auto-created playlist activation updates current route", failures);
  assertContains(addButtonSource, "if (createdPlaylistId && selectedPlaylist.id === createdPlaylistId) {", "Auto-created playlist path activates the new playlist after add", failures);

  // Add-to-playlist menu invariants (header, options, close button, interactions).
  assertContains(addButtonSource, "<strong>Add to...</strong>", "Add-to-playlist menu has 'Add to...' header", failures);
  assertContains(addButtonSource, "New playlist", "Add-to-playlist menu has 'New playlist' option", failures);
  assertContains(addButtonSource, "New playlist then open", "Add-to-playlist menu has 'New playlist then open' option", failures);
  assertContains(addButtonSource, "Existing playlist", "Add-to-playlist menu has 'Existing playlist' option", failures);
  assertContains(addButtonSource, "Existing playlist then open", "Add-to-playlist menu has 'Existing playlist then open' option", failures);
  assertContains(addButtonSource, "className=\"playlistQuickAddMenuClose\"", "Add-to-playlist menu has close button with correct class", failures);
  assertContains(addButtonSource, "onClick={() => setMenuOpen(false)}", "Add-to-playlist menu close button closes menu", failures);
  assertContains(addButtonSource, "dispatchAppEvent(EVENT_NAMES.PLAYLIST_CHOOSER_STATE", "Playlist chooser broadcasts state events", failures);
  assertContains(addButtonSource, "dispatchAppEvent(EVENT_NAMES.PLAYLIST_CHOOSER_STATE", "Add-to-playlist broadcasts chooser open/close state", failures);
  assertContains(addButtonSource, "function handleScroll() {", "Add-to-playlist menu has scroll handler", failures);
  assertContains(addButtonSource, "setMenuOpen(false);", "Scroll handler closes menu", failures);
  assertContains(addButtonSource, 'window.addEventListener("scroll", handleScroll, true);', "Menu scroll close listener is registered with capture phase", failures);
  assertContains(addButtonSource, "createPortal(", "Add-to-playlist menu uses portal rendering", failures);
  assertContains(addButtonSource, "document.body", "Menu portal renders to document.body", failures);
  assertContains(cssSource, ".playlistQuickAddMenuHeader {", "CSS defines menu header styles", failures);
  assertContains(cssSource, "display: flex;", "Menu header uses flex layout", failures);
  assertContains(cssSource, "justify-content: space-between;", "Menu header justifies content between title and close", failures);
  assertContains(cssSource, ".playlistQuickAddMenuClose {", "CSS defines menu close button styles", failures);
  assertContains(cssSource, "background: rgba(126, 19, 19, 0.6);", "Menu close button is red", failures);
  assertContains(cssSource, "var(--font-display)", "Menu header uses Metal Mania display font", failures);
  assertContains(playerSource, "const [playlistChooserOpen, setPlaylistChooserOpen] = useState(false);", "Player tracks playlist chooser state", failures);
  assertContains(playerSource, "\"ytr:playlist-chooser-state\"", "Player listens to playlist chooser state events", failures);
  assertContains(playerSource, "|| playlistChooserOpen", "Player blocks footer actions when chooser is open", failures);

  // Playlist rail delete button invariants.
  assertContains(shellSource, "const [playlistBeingDeletedId, setPlaylistBeingDeletedId] = useState<string | null>(null);", "Shell tracks playlist being deleted from rail", failures);
  assertContains(shellSource, "const [confirmDeleteRailPlaylist, setConfirmDeleteRailPlaylist] = useState<{ id: string; name: string } | null>(null);", "Shell tracks pending playlist delete confirmation state", failures);
  assertContains(shellSource, "async function handleDeletePlaylistFromRail(playlistId: string)", "Shell has delete handler for playlist rail card", failures);
  assertContains(shellSource, "className=\"rightRailPlaylistCardDelete\"", "Playlist rail cards have delete button", failures);
  assertContains(shellSource, "setConfirmDeleteRailPlaylist({ id: playlist.id, name: playlist.name });", "Playlist rail delete button opens confirmation modal", failures);
  assertContains(shellSource, "void handleDeletePlaylistFromRail(playlistId);", "Playlist rail confirmation modal invokes delete handler", failures);
  assertContains(cssSource, ".rightRailPlaylistCardDelete {", "CSS defines delete button for rail cards", failures);
  assertContains(cssSource, "position: absolute;", "Delete button is positioned absolutely", failures);
  assertContains(cssSource, "top: 8px;", "Delete button positioned at top", failures);
  assertContains(cssSource, "right: 8px;", "Delete button positioned at right", failures);

  // Player playlist rail fixed-header invariants.
  assertContains(shellSource, "<div className=\"rightRailPlaylistBar\">", "Player rail playlist header exists", failures);
  assertContains(shellSource, "<div className=\"relatedStackPlaylistBody\" ref={playlistStackBodyRef}>", "Player rail has dedicated scroll body", failures);
  assertContains(cssSource, ".relatedStackPlaylistBody", "CSS defines dedicated scroll body class", failures);
  assertContains(cssSource, "overflow-y: auto;", "Playlist rail body scrolls independently", failures);
  assertContains(shellSource, "const requestedPlaylistItemIndex = (() => {", "Playlist rail derives requested playlist item index from URL", failures);
  assertContains(shellSource, "const matchedPlaylistVideoIndex = playlistRailData", "Playlist rail derives active index from current playback", failures);
  assertContains(shellSource, "const hasTrustedRequestedPlaylistItemIndex = requestedPlaylistItemIndex !== null", "Playlist rail only trusts URL item index when valid", failures);
  assertContains(shellSource, "playlistRailData.videos[requestedPlaylistItemIndex]?.id === currentVideo.id", "Playlist rail validates URL index against currently playing video", failures);
  assertContains(shellSource, "const activePlaylistTrackIndex = hasTrustedRequestedPlaylistItemIndex", "Playlist rail computes a single active track index source of truth", failures);
  assertContains(shellSource, "const playlistStackBodyRef = useRef<HTMLDivElement | null>(null);", "Playlist rail keeps a dedicated scroll-body ref", failures);
  assertContains(shellSource, "const playlistAutoScrollRafRef = useRef<number | null>(null);", "Playlist rail tracks animation frame id for smooth auto-scroll", failures);
  assertContains(shellSource, "data-playlist-index={index}", "Playlist rail rows expose playlist index data attribute", failures);
  assertContains(shellSource, ".playlistRailTrackRow[data-playlist-index=\"${activePlaylistTrackIndex}\"]", "Playlist rail scroll targets indexed active row", failures);
  assertContains(shellSource, "const topGutterPx = 8;", "Playlist rail keeps active row aligned near top gutter", failures);
  assertContains(shellSource, "const durationMs = 320;", "Playlist rail auto-scroll uses slowed smooth animation duration", failures);
  assertContains(shellSource, "const eased = 1 - ((1 - progress) ** 3);", "Playlist rail auto-scroll uses easing for smooth settle", failures);
  assertContains(shellSource, "window.cancelAnimationFrame(playlistAutoScrollRafRef.current);", "Playlist rail cancels stale auto-scroll animation before starting a new one", failures);
  assertContains(playerSource, "listenToAppEvent(EVENT_NAMES.PLAYLISTS_UPDATED", "Player listens to playlist update event", failures);
  assertMatches(playerSource, /\[activePlaylistId, isLoggedIn, playlistRefreshTick\]/, "Player reload effect depends on playlist refresh tick", failures);

  // Quick sanity that this invariant script is wired in package scripts.
  assertContains(packageJsonSource, "verify:playlists-ui", "Root package includes playlist UI verify script", failures);

  if (failures.length > 0) {
    console.error("Playlist UI invariant check failed.");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log("Playlist UI invariant check passed.");
}

main();
