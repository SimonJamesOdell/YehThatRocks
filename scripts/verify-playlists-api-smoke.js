#!/usr/bin/env node
"use strict";

function readArg(name, fallback) {
  const raw = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (!raw) {
    return fallback;
  }

  const value = raw.slice(name.length + 3);
  return value || fallback;
}

function asNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isYouTubeId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{11}$/.test(value);
}

function assertInvariant(condition, description, details, failures) {
  if (condition) {
    console.log(`[ok] ${description}`);
    return;
  }

  failures.push({ description, details });
  console.error(`[fail] ${description}`);
  if (details) {
    console.error(`       ${details}`);
  }
}

async function fetchJson(url, init, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      ...init,
      signal: controller.signal,
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    return { response, payload };
  } finally {
    clearTimeout(timeoutId);
  }
}

function withAuthHeaders(baseUrl, cookie) {
  return {
    Cookie: cookie,
    Origin: baseUrl,
    Referer: `${baseUrl}/`,
    "Content-Type": "application/json",
    "Cache-Control": "no-cache",
  };
}

async function getTwoDistinctTopVideoIds(baseUrl, timeoutMs) {
  const { response, payload } = await fetchJson(`${baseUrl}/api/videos/top?count=20`, { method: "GET" }, timeoutMs);

  if (!response.ok) {
    return [];
  }

  const videos = Array.isArray(payload?.videos) ? payload.videos : [];
  const ids = [];

  for (const video of videos) {
    if (!isYouTubeId(video?.id)) {
      continue;
    }

    if (!ids.includes(video.id)) {
      ids.push(video.id);
    }

    if (ids.length >= 2) {
      break;
    }
  }

  return ids;
}

async function main() {
  const baseUrl = readArg("base-url", "http://localhost:3000").replace(/\/$/, "");
  const timeoutMs = Math.max(1000, asNumber(readArg("timeout-ms", "6000"), 6000));
  const sessionCookie = readArg("session-cookie", process.env.PLAYLISTS_SMOKE_COOKIE || "");
  const failures = [];

  console.log("Playlist API smoke checks\n");
  console.log(`baseUrl=${baseUrl} timeoutMs=${timeoutMs} authCookieProvided=${sessionCookie ? "yes" : "no"}\n`);

  const unauthChecks = [
    { name: "Playlist list requires authentication", url: `${baseUrl}/api/playlists`, init: { method: "GET" } },
    {
      name: "Playlist create requires authentication",
      url: `${baseUrl}/api/playlists`,
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Smoke Playlist", videoIds: [] }),
      },
    },
    { name: "Playlist detail requires authentication", url: `${baseUrl}/api/playlists/1`, init: { method: "GET" } },
    {
      name: "Playlist item add requires authentication",
      url: `${baseUrl}/api/playlists/1/items`,
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId: "dQw4w9WgXcQ" }),
      },
    },
    {
      name: "Playlist item remove requires authentication",
      url: `${baseUrl}/api/playlists/1/items`,
      init: {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playlistItemIndex: 0 }),
      },
    },
    {
      name: "Playlist item reorder requires authentication",
      url: `${baseUrl}/api/playlists/1/items`,
      init: {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromIndex: 0, toIndex: 1 }),
      },
    },
  ];

  for (const check of unauthChecks) {
    const result = await fetch(check.url, { cache: "no-store", ...check.init }).catch((error) => ({ error }));
    if (result?.error) {
      assertInvariant(false, `${check.name} endpoint reachable`, String(result.error), failures);
      continue;
    }

    assertInvariant(
      result.status === 401 || result.status === 403,
      check.name,
      `status=${result.status}`,
      failures,
    );
  }

  if (!sessionCookie) {
    console.log("\nAuth cookie not provided; skipping authenticated playlist mutation checks.");
  } else {
    const authHeaders = withAuthHeaders(baseUrl, sessionCookie);
    let createdPlaylistId = null;

    try {
      const listResult = await fetchJson(
        `${baseUrl}/api/playlists`,
        { method: "GET", headers: { Cookie: sessionCookie, "Cache-Control": "no-cache" } },
        timeoutMs,
      ).catch((error) => ({ error }));

      if (listResult?.error) {
        assertInvariant(false, "Authenticated playlist list endpoint reachable", String(listResult.error), failures);
      } else {
        const { response, payload } = listResult;
        const playlists = Array.isArray(payload?.playlists) ? payload.playlists : [];
        assertInvariant(response.ok, "Authenticated playlist list returns 2xx", `status=${response.status}`, failures);
        assertInvariant(Array.isArray(playlists), "Authenticated playlist list returns playlists array", "payload.playlists is not an array", failures);
      }

      const [videoIdA, videoIdB] = await getTwoDistinctTopVideoIds(baseUrl, timeoutMs);
      assertInvariant(Boolean(videoIdA), "Found at least one valid video id for mutation smoke", `videoIdA=${String(videoIdA)}`, failures);
      assertInvariant(Boolean(videoIdB), "Found second valid video id for reorder smoke", `videoIdB=${String(videoIdB)}`, failures);

      if (videoIdA && videoIdB) {
        const playlistName = `Smoke ${Date.now()}`;
        const createResult = await fetchJson(
          `${baseUrl}/api/playlists`,
          {
            method: "POST",
            headers: authHeaders,
            body: JSON.stringify({ name: playlistName, videoIds: [] }),
          },
          timeoutMs,
        ).catch((error) => ({ error }));

        if (createResult?.error) {
          assertInvariant(false, "Authenticated playlist create endpoint reachable", String(createResult.error), failures);
        } else {
          const { response, payload } = createResult;
          createdPlaylistId = typeof payload?.id === "string" ? payload.id : null;
          assertInvariant(response.status === 201, "Authenticated playlist create returns 201", `status=${response.status}`, failures);
          assertInvariant(Boolean(createdPlaylistId), "Authenticated playlist create returns playlist id", `id=${String(payload?.id)}`, failures);
        }

        if (createdPlaylistId) {
          let firstPlaylistItemId = null;

          const addOne = await fetchJson(
            `${baseUrl}/api/playlists/${encodeURIComponent(createdPlaylistId)}/items`,
            {
              method: "POST",
              headers: authHeaders,
              body: JSON.stringify({ videoId: videoIdA }),
            },
            timeoutMs,
          ).catch((error) => ({ error }));

          if (addOne?.error) {
            assertInvariant(false, "Authenticated first add endpoint reachable", String(addOne.error), failures);
          } else {
            assertInvariant(addOne.response.status === 201, "Authenticated first add returns 201", `status=${addOne.response.status}`, failures);
          }

          const addTwo = await fetchJson(
            `${baseUrl}/api/playlists/${encodeURIComponent(createdPlaylistId)}/items`,
            {
              method: "POST",
              headers: authHeaders,
              body: JSON.stringify({ videoId: videoIdB }),
            },
            timeoutMs,
          ).catch((error) => ({ error }));

          if (addTwo?.error) {
            assertInvariant(false, "Authenticated second add endpoint reachable", String(addTwo.error), failures);
          } else {
            assertInvariant(addTwo.response.status === 201, "Authenticated second add returns 201", `status=${addTwo.response.status}`, failures);
          }

          const detailBeforeDup = await fetchJson(
            `${baseUrl}/api/playlists/${encodeURIComponent(createdPlaylistId)}`,
            { method: "GET", headers: { Cookie: sessionCookie, "Cache-Control": "no-cache" } },
            timeoutMs,
          ).catch((error) => ({ error }));

          let beforeCount = 0;
          if (detailBeforeDup?.error) {
            assertInvariant(false, "Authenticated detail before duplicate endpoint reachable", String(detailBeforeDup.error), failures);
          } else {
            const { response, payload } = detailBeforeDup;
            const videos = Array.isArray(payload?.videos) ? payload.videos : [];
            beforeCount = Number(payload?.itemCount ?? videos.length ?? 0);
            assertInvariant(response.ok, "Authenticated detail before duplicate returns 2xx", `status=${response.status}`, failures);
            assertInvariant(videos.length >= 2, "Authenticated detail includes added items", `videos.length=${videos.length}`, failures);
          }

          const duplicateAdd = await fetchJson(
            `${baseUrl}/api/playlists/${encodeURIComponent(createdPlaylistId)}/items`,
            {
              method: "POST",
              headers: authHeaders,
              body: JSON.stringify({ videoId: videoIdA }),
            },
            timeoutMs,
          ).catch((error) => ({ error }));

          if (duplicateAdd?.error) {
            assertInvariant(false, "Authenticated duplicate add endpoint reachable", String(duplicateAdd.error), failures);
          } else {
            assertInvariant(
              duplicateAdd.response.status === 200 || duplicateAdd.response.status === 201,
              "Authenticated duplicate add returns non-error response",
              `status=${duplicateAdd.response.status}`,
              failures,
            );
          }

          const detailAfterDup = await fetchJson(
            `${baseUrl}/api/playlists/${encodeURIComponent(createdPlaylistId)}`,
            { method: "GET", headers: { Cookie: sessionCookie, "Cache-Control": "no-cache" } },
            timeoutMs,
          ).catch((error) => ({ error }));

          if (detailAfterDup?.error) {
            assertInvariant(false, "Authenticated detail after duplicate endpoint reachable", String(detailAfterDup.error), failures);
          } else {
            const { response, payload } = detailAfterDup;
            const videos = Array.isArray(payload?.videos) ? payload.videos : [];
            const afterCount = Number(payload?.itemCount ?? videos.length ?? 0);
            const idACount = videos.filter((video) => video?.id === videoIdA).length;

            assertInvariant(response.ok, "Authenticated detail after duplicate returns 2xx", `status=${response.status}`, failures);
            assertInvariant(afterCount === beforeCount, "Duplicate add does not increase playlist item count", `before=${beforeCount} after=${afterCount}`, failures);
            assertInvariant(idACount <= 1, "Duplicate add keeps at most one instance of same video id", `videoId=${videoIdA} occurrences=${idACount}`, failures);
          }

          const reorderResult = await fetchJson(
            `${baseUrl}/api/playlists/${encodeURIComponent(createdPlaylistId)}/items`,
            {
              method: "PATCH",
              headers: authHeaders,
              body: JSON.stringify({ fromIndex: 1, toIndex: 0 }),
            },
            timeoutMs,
          ).catch((error) => ({ error }));

          if (reorderResult?.error) {
            assertInvariant(false, "Authenticated reorder endpoint reachable", String(reorderResult.error), failures);
          } else {
            assertInvariant(reorderResult.response.ok, "Authenticated reorder returns 2xx", `status=${reorderResult.response.status}`, failures);
          }

          const detailAfterReorder = await fetchJson(
            `${baseUrl}/api/playlists/${encodeURIComponent(createdPlaylistId)}`,
            { method: "GET", headers: { Cookie: sessionCookie, "Cache-Control": "no-cache" } },
            timeoutMs,
          ).catch((error) => ({ error }));

          if (detailAfterReorder?.error) {
            assertInvariant(false, "Authenticated detail after reorder endpoint reachable", String(detailAfterReorder.error), failures);
          } else {
            const { response, payload } = detailAfterReorder;
            const videos = Array.isArray(payload?.videos) ? payload.videos : [];
            const firstId = videos[0]?.id;
            firstPlaylistItemId = typeof videos[0]?.playlistItemId === "string" ? videos[0].playlistItemId : null;

            assertInvariant(response.ok, "Authenticated detail after reorder returns 2xx", `status=${response.status}`, failures);
            assertInvariant(firstId === videoIdB, "Reorder moves second item to first position", `expectedFirst=${videoIdB} actualFirst=${String(firstId)}`, failures);
            assertInvariant(
              typeof firstPlaylistItemId === "string" && firstPlaylistItemId.length > 0,
              "Playlist detail exposes stable playlistItemId for each row",
              `firstPlaylistItemId=${String(firstPlaylistItemId)}`,
              failures,
            );
          }

          const removeBody = firstPlaylistItemId
            ? { playlistItemId: firstPlaylistItemId }
            : { playlistItemIndex: 0 };

          const removeResult = await fetchJson(
            `${baseUrl}/api/playlists/${encodeURIComponent(createdPlaylistId)}/items`,
            {
              method: "DELETE",
              headers: authHeaders,
              body: JSON.stringify(removeBody),
            },
            timeoutMs,
          ).catch((error) => ({ error }));

          if (removeResult?.error) {
            assertInvariant(false, "Authenticated remove endpoint reachable", String(removeResult.error), failures);
          } else {
            assertInvariant(removeResult.response.ok, "Authenticated remove returns 2xx", `status=${removeResult.response.status}`, failures);
          }
        }
      }
    } finally {
      if (createdPlaylistId) {
        const cleanup = await fetch(`${baseUrl}/api/playlists/${encodeURIComponent(createdPlaylistId)}`, {
          method: "DELETE",
          cache: "no-store",
          headers: {
            Cookie: sessionCookie,
            Origin: baseUrl,
            Referer: `${baseUrl}/`,
            "Cache-Control": "no-cache",
          },
        }).catch(() => null);

        if (!cleanup || !cleanup.ok) {
          console.warn(`[warn] Could not clean up smoke playlist id=${createdPlaylistId}`);
        } else {
          console.log(`[ok] Cleaned up smoke playlist id=${createdPlaylistId}`);
        }
      }
    }
  }

  if (failures.length > 0) {
    console.error(`\nPlaylist API smoke check failed: ${failures.length} issue(s).`);
    process.exit(1);
  }

  console.log("\nPlaylist API smoke check passed.");
}

main().catch((error) => {
  console.error("Fatal error in playlist API smoke checker:", error);
  process.exit(1);
});
