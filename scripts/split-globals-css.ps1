#!/usr/bin/env pwsh
# Splits apps/web/app/globals.css into domain-focused partials under apps/web/app/styles/
# and replaces globals.css with @import rules.

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$src  = Join-Path $root "apps/web/app/globals.css"
$outDir = Join-Path $root "apps/web/app/styles"

if (-not (Test-Path $outDir)) {
    New-Item -ItemType Directory -Path $outDir | Out-Null
}

$lines = Get-Content $src -Encoding UTF8

function WriteSlice([string]$name, [int]$from, [int]$to) {
    # $from and $to are 1-based line numbers, inclusive
    $content = $lines[($from - 1)..($to - 1)] -join "`n"
    $dest = Join-Path $outDir $name
    [System.IO.File]::WriteAllText($dest, $content + "`n", [System.Text.UTF8Encoding]::new($false))
    Write-Host "  wrote $name  ($from-$to, $($to - $from + 1) lines)"
}

Write-Host "Splitting $src ($($lines.Count) lines) into $outDir ..."

# 1. CSS custom properties
WriteSlice "tokens.css"            1      57

# 2. Shared primitive components (badges, modals, loading bars, action chips, boot bars)
WriteSlice "ui-primitives.css"     58     254

# 3. Shell structure and intro animation
WriteSlice "shell.css"             255    412

# 4. Header, brand, nav links and search box
WriteSlice "header-nav.css"        413    849

# 5. Layout rails (heroGrid, panels, leftRail/rightRail, rail tabs, chat, lyrics, guest rail, magazine rail)
WriteSlice "rails.css"             850    1355

# 6. Player chrome, dock, service failure, boot loader, playback denied, hide-video confirm
WriteSlice "player-chrome.css"     1356   4234

# 7. Player overlays: nowPlaying, videoUnavailable, policyBlocker, endedChoice
WriteSlice "player-overlays.css"   4235   4972

# 8. Player primary actions, footer controls, share URL, toasts, docked admin
WriteSlice "player-actions.css"    4973   5510

# 9. Playlist quick-add, right rail playlist management, relatedStack, general layout utilities
WriteSlice "playlist-ui.css"       5511   6275

# 10. Track and related cards, linked card, leaderboard, top100, search result buttons
WriteSlice "track-cards.css"       6276   7282

# 11. New page header, flag modal, suggest modal, playlist editor drag, thumbnails, history
WriteSlice "new-page.css"          7283   8060

# 12. Catalog grids, categories, artists, favourites, playlists pages, category/artist video cards, artist wiki
WriteSlice "browse.css"            8061   9416

# 13. Auth forms, status banners, auth status modals, performance modal, auth modal overlay
WriteSlice "auth.css"              9417   10220

# 14. Account settings forms, user public profile
WriteSlice "account.css"           10221  10645

# 15. Admin dashboard status, adminOverview, responsive media query overrides
WriteSlice "admin.css"             10646  11065

# 16. Auth modal panel, playerAuthWall, guest rail CTA
WriteSlice "auth-modal.css"        11066  $lines.Count

# Build new globals.css with @import rules only
$imports = @(
    "@import './styles/tokens.css';",
    "@import './styles/ui-primitives.css';",
    "@import './styles/shell.css';",
    "@import './styles/header-nav.css';",
    "@import './styles/rails.css';",
    "@import './styles/player-chrome.css';",
    "@import './styles/player-overlays.css';",
    "@import './styles/player-actions.css';",
    "@import './styles/playlist-ui.css';",
    "@import './styles/track-cards.css';",
    "@import './styles/new-page.css';",
    "@import './styles/browse.css';",
    "@import './styles/auth.css';",
    "@import './styles/account.css';",
    "@import './styles/admin.css';",
    "@import './styles/auth-modal.css';"
) -join "`n"

[System.IO.File]::WriteAllText($src, $imports + "`n", [System.Text.UTF8Encoding]::new($false))
Write-Host "`nglobals.css replaced with @import entry point ($($imports.Split("`n").Count) lines)"
Write-Host "Done."
