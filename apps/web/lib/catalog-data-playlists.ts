/**
 * catalog-data-playlists.ts
 * Playlists domain: create, read, update, delete playlist and playlist items.
 */

import { prisma } from "@/lib/db";
import type { PlaylistSummary, PlaylistDetail, PlaylistVideoRecord, RankedVideoRow } from "@/lib/catalog-data-utils";
import {
  hasDatabaseUrl,
  mapPlaylistVideo,
  normalizeYouTubeVideoId,
  escapeSqlIdentifier,
  seedVideos,
} from "@/lib/catalog-data-utils";
import { loadTableColumns, pickColumn } from "@/lib/catalog-data-db";

// ── Preview store (no-database mode) ─────────────────────────────────────────

type PreviewStore = {
  favouriteIdsByUser: Map<number, Set<string>>;
  playlistsByUser: Map<number, PlaylistDetail[]>;
};

const PREVIEW_DEFAULT_USER_ID = 1;

const seedPlaylists: PlaylistDetail[] = [
  {
    id: "1",
    name: "Late Night Riffs",
    videos: [seedVideos[0], seedVideos[2], seedVideos[4]] as PlaylistVideoRecord[],
  },
  {
    id: "2",
    name: "Cathedral Echoes",
    videos: [seedVideos[3], seedVideos[0], seedVideos[1]] as PlaylistVideoRecord[],
  },
  {
    id: "3",
    name: "Gym Violence",
    videos: [seedVideos[4], seedVideos[2], seedVideos[1]] as PlaylistVideoRecord[],
  },
];

declare global {
  // eslint-disable-next-line no-var
  var __yehPreviewStore: PreviewStore | undefined;
}

function createPreviewStore(): PreviewStore {
  return {
    favouriteIdsByUser: new Map([
      [PREVIEW_DEFAULT_USER_ID, new Set(seedVideos.slice(0, 3).map((video) => video.id))],
    ]),
    playlistsByUser: new Map([
      [
        PREVIEW_DEFAULT_USER_ID,
        seedPlaylists.map((playlist) => ({
          ...playlist,
          videos: [...playlist.videos],
        })),
      ],
    ]),
  };
}

function getPreviewStore(): PreviewStore {
  if (!globalThis.__yehPreviewStore) {
    globalThis.__yehPreviewStore = createPreviewStore();
  }

  return globalThis.__yehPreviewStore;
}

// ── Private helpers ───────────────────────────────────────────────────────────

function getSeedPlaylists() {
  return getPreviewStore().playlistsByUser.get(PREVIEW_DEFAULT_USER_ID) ?? [];
}

function toPlaylistSummary(playlist: PlaylistDetail): PlaylistSummary {
  return {
    id: playlist.id,
    name: playlist.name,
    itemCount: playlist.videos.length,
    leadVideoId: playlist.videos[0]?.id ?? "",
  };
}

// ── Public exports ────────────────────────────────────────────────────────────

export async function getPlaylists(userId?: number): Promise<PlaylistSummary[]> {
  if (!hasDatabaseUrl()) {
    return [];
  }

  if (!userId) {
    return [];
  }

  try {
    type PlaylistSummaryRow = {
      id: number | bigint;
      name: string | null;
      itemCount: number | bigint;
      leadVideoId: string | null;
    };

    const rowsByLegacySchema = await (async () => {
      try {
        return await prisma.$queryRaw<PlaylistSummaryRow[]>`
          SELECT
            p.id AS id,
            p.name AS name,
            (
              SELECT COUNT(*)
              FROM playlistitems pi
              WHERE pi.playlistId = p.id
            ) AS itemCount,
            (
              SELECT pi.videoId
              FROM playlistitems pi
              WHERE pi.playlistId = p.id
              ORDER BY pi.id ASC
              LIMIT 1
            ) AS leadVideoId
          FROM playlistnames p
          WHERE p.userId = ${userId}
          ORDER BY p.id DESC
          LIMIT 24
        `;
      } catch {
        return [] as PlaylistSummaryRow[];
      }
    })();

    const rowsByMappedSchema = await (async () => {
      try {
        return await prisma.$queryRaw<PlaylistSummaryRow[]>`
          SELECT
            p.id AS id,
            p.name AS name,
            (
              SELECT COUNT(*)
              FROM playlistitems pi
              WHERE pi.playlist_id = p.id
            ) AS itemCount,
            (
              SELECT v.videoId
              FROM playlistitems pi
              LEFT JOIN videos v ON v.id = pi.video_id
              WHERE pi.playlist_id = p.id
              ORDER BY pi.id ASC
              LIMIT 1
            ) AS leadVideoId
          FROM playlistnames p
          WHERE p.user_id = ${userId}
          ORDER BY p.id DESC
          LIMIT 24
        `;
      } catch {
        return [] as PlaylistSummaryRow[];
      }
    })();

    const legacyTotal = rowsByLegacySchema.reduce((sum, row) => {
      const count =
        typeof row.itemCount === "bigint"
          ? Number(row.itemCount)
          : Number(row.itemCount ?? 0);
      return sum + (Number.isFinite(count) ? count : 0);
    }, 0);

    const mappedTotal = rowsByMappedSchema.reduce((sum, row) => {
      const count =
        typeof row.itemCount === "bigint"
          ? Number(row.itemCount)
          : Number(row.itemCount ?? 0);
      return sum + (Number.isFinite(count) ? count : 0);
    }, 0);

    const rows = (() => {
      if (rowsByLegacySchema.length === 0 && rowsByMappedSchema.length > 0) {
        return rowsByMappedSchema;
      }

      if (rowsByMappedSchema.length === 0 && rowsByLegacySchema.length > 0) {
        return rowsByLegacySchema;
      }

      if (mappedTotal > legacyTotal) {
        return rowsByMappedSchema;
      }

      if (legacyTotal > mappedTotal) {
        return rowsByLegacySchema;
      }

      if (rowsByMappedSchema.length > rowsByLegacySchema.length) {
        return rowsByMappedSchema;
      }

      return rowsByLegacySchema;
    })();

    if (rows.length === 0) {
      return [];
    }

    return rows.map((row) => {
      const lead =
        typeof row.leadVideoId === "string" && row.leadVideoId.length > 0
          ? row.leadVideoId
          : "__placeholder__";
      const count =
        typeof row.itemCount === "bigint"
          ? Number(row.itemCount)
          : Number(row.itemCount ?? 0);

      return {
        id: String(typeof row.id === "bigint" ? Number(row.id) : row.id),
        name: row.name ?? "Untitled Playlist",
        itemCount: Number.isFinite(count) ? count : 0,
        leadVideoId: lead,
      };
    });
  } catch {
    return [];
  }
}

export async function getPlaylistById(id: string, userId?: number): Promise<PlaylistDetail | null> {
  if (!hasDatabaseUrl() || !userId) {
    return null;
  }

  const numericId = Number(id);

  if (!Number.isInteger(numericId)) {
    return null;
  }

  try {
    const playlistRowsByLegacyOwner = await (async () => {
      try {
        return await prisma.$queryRaw<Array<{ id: number | bigint; name: string | null }>>`
          SELECT id, name
          FROM playlistnames
          WHERE id = ${numericId} AND userId = ${userId}
          LIMIT 1
        `;
      } catch {
        return [] as Array<{ id: number | bigint; name: string | null }>;
      }
    })();

    const playlistRowsByMappedOwner = await (async () => {
      try {
        return await prisma.$queryRaw<Array<{ id: number | bigint; name: string | null }>>`
          SELECT id, name
          FROM playlistnames
          WHERE id = ${numericId} AND user_id = ${userId}
          LIMIT 1
        `;
      } catch {
        return [] as Array<{ id: number | bigint; name: string | null }>;
      }
    })();

    const playlist = playlistRowsByLegacyOwner[0] ?? playlistRowsByMappedOwner[0];

    if (!playlist) {
      return null;
    }

    type PlaylistDetailRow = RankedVideoRow & {
      playlistItemId: number | bigint;
    };

    const collapseToPlaylistItems = (rows: PlaylistDetailRow[]) => {
      const byPlaylistItemId = new Map<string, RankedVideoRow>();

      for (const row of rows) {
        const itemId =
          typeof row.playlistItemId === "bigint"
            ? row.playlistItemId.toString()
            : String(row.playlistItemId);

        if (byPlaylistItemId.has(itemId)) {
          continue;
        }

        byPlaylistItemId.set(itemId, {
          videoId: row.videoId,
          title: row.title,
          channelTitle: row.channelTitle,
          favourited: row.favourited,
          description: row.description,
        });
      }

      return [...byPlaylistItemId.entries()].map(([playlistItemId, video]) => ({
        ...video,
        playlistItemId,
      }));
    };

    const queryVariants: Array<() => Promise<PlaylistDetailRow[]>> = [
      async () =>
        prisma.$queryRaw<PlaylistDetailRow[]>`
          SELECT
            pi.id AS playlistItemId,
            COALESCE(v.videoId, pi.videoId) AS videoId,
            COALESCE(v.title, CONCAT('Video ', pi.videoId)) AS title,
            COALESCE(v.parsedArtist, NULL) AS channelTitle,
            COALESCE(v.favourited, 0) AS favourited,
            COALESCE(v.description, 'Playlist track') AS description
          FROM playlistitems pi
          LEFT JOIN videos v ON v.videoId = pi.videoId
          WHERE pi.playlistId = ${numericId}
          ORDER BY pi.id ASC
        `,
      async () =>
        prisma.$queryRaw<PlaylistDetailRow[]>`
          SELECT
            pi.id AS playlistItemId,
            COALESCE(v.videoId, CAST(pi.videoId AS CHAR)) AS videoId,
            COALESCE(v.title, CONCAT('Video ', CAST(pi.videoId AS CHAR))) AS title,
            COALESCE(v.parsedArtist, NULL) AS channelTitle,
            COALESCE(v.favourited, 0) AS favourited,
            COALESCE(v.description, 'Playlist track') AS description
          FROM playlistitems pi
          LEFT JOIN videos v ON v.id = pi.videoId
          WHERE pi.playlistId = ${numericId}
          ORDER BY pi.id ASC
        `,
      async () =>
        prisma.$queryRaw<PlaylistDetailRow[]>`
          SELECT
            pi.id AS playlistItemId,
            COALESCE(v.videoId, CAST(pi.video_id AS CHAR)) AS videoId,
            COALESCE(v.title, CONCAT('Video ', CAST(pi.video_id AS CHAR))) AS title,
            COALESCE(v.parsedArtist, NULL) AS channelTitle,
            COALESCE(v.favourited, 0) AS favourited,
            COALESCE(v.description, 'Playlist track') AS description
          FROM playlistitems pi
          LEFT JOIN videos v ON v.id = pi.video_id
          WHERE pi.playlist_id = ${numericId}
          ORDER BY pi.id ASC
        `,
      async () =>
        prisma.$queryRaw<PlaylistDetailRow[]>`
          SELECT
            pi.id AS playlistItemId,
            COALESCE(v.videoId, pi.video_id) AS videoId,
            COALESCE(v.title, CONCAT('Video ', pi.video_id)) AS title,
            COALESCE(v.parsedArtist, NULL) AS channelTitle,
            COALESCE(v.favourited, 0) AS favourited,
            COALESCE(v.description, 'Playlist track') AS description
          FROM playlistitems pi
          LEFT JOIN videos v ON v.videoId = pi.video_id
          WHERE pi.playlist_id = ${numericId}
          ORDER BY pi.id ASC
        `,
    ];

    let videoRows: Array<RankedVideoRow & { playlistItemId: string }> = [];

    for (const query of queryVariants) {
      try {
        const rows = await query();
        const collapsed = collapseToPlaylistItems(rows);

        if (collapsed.length > videoRows.length) {
          videoRows = collapsed;
        }
      } catch {
        // Try next known schema variant.
      }
    }

    {
      const [playlistColumns, videoColumns] = await Promise.all([
        loadTableColumns("playlistitems"),
        loadTableColumns("videos"),
      ]);

      const playlistRef = pickColumn(playlistColumns, ["playlist_id", "playlistId", "playlistid"]);
      const videoRef = pickColumn(playlistColumns, ["video_id", "videoId", "videoid"]);
      const orderRef = pickColumn(playlistColumns, [
        "sort_order",
        "sortOrder",
        "display_order",
        "displayOrder",
        "order_index",
        "orderIndex",
        "position",
        "sequence",
        "idx",
        "id",
      ]);
      const rowIdRef = pickColumn(playlistColumns, ["id"]);
      const videoPkRef = pickColumn(videoColumns, ["id"]);
      const videoExternalIdRef = pickColumn(videoColumns, ["videoId", "video_id", "videoid"]);
      const videoTitleRef = pickColumn(videoColumns, ["title"]);
      const videoArtistRef = pickColumn(videoColumns, [
        "parsedArtist",
        "parsed_artist",
        "artist",
        "channelTitle",
        "channel_title",
        "channel",
      ]);
      const videoFavouritedRef = pickColumn(videoColumns, [
        "favourited",
        "favorite",
        "is_favourited",
      ]);
      const videoDescriptionRef = pickColumn(videoColumns, ["description", "desc"]);
      const isPlaylistVideoRefNumeric = Boolean(
        videoRef && /int|bigint|smallint|tinyint/i.test(videoRef.Type),
      );

      if (playlistRef && videoRef && orderRef && rowIdRef && videoExternalIdRef) {
        const playlistCol = escapeSqlIdentifier(playlistRef.Field);
        const videoCol = escapeSqlIdentifier(videoRef.Field);
        const orderCol = escapeSqlIdentifier(orderRef.Field);
        const rowIdCol = escapeSqlIdentifier(rowIdRef.Field);
        const externalVideoCol = escapeSqlIdentifier(videoExternalIdRef.Field);
        const titleExpr = videoTitleRef
          ? `v.${escapeSqlIdentifier(videoTitleRef.Field)}`
          : "NULL";
        const artistExpr = videoArtistRef
          ? `v.${escapeSqlIdentifier(videoArtistRef.Field)}`
          : "NULL";
        const favouritedExpr = videoFavouritedRef
          ? `v.${escapeSqlIdentifier(videoFavouritedRef.Field)}`
          : "0";
        const descriptionExpr = videoDescriptionRef
          ? `v.${escapeSqlIdentifier(videoDescriptionRef.Field)}`
          : "NULL";

        const joinCondition =
          isPlaylistVideoRefNumeric && videoPkRef
            ? `v.${escapeSqlIdentifier(videoPkRef.Field)} = pi.${videoCol}`
            : `v.${externalVideoCol} = pi.${videoCol}`;

        const unresolvedVideoExpr = isPlaylistVideoRefNumeric
          ? `CAST(pi.${videoCol} AS CHAR)`
          : `pi.${videoCol}`;

        try {
          const fallbackRows = await prisma.$queryRawUnsafe<PlaylistDetailRow[]>(
            `
              SELECT
                pi.${rowIdCol} AS playlistItemId,
                COALESCE(v.${externalVideoCol}, ${unresolvedVideoExpr}) AS videoId,
                COALESCE(${titleExpr}, CONCAT('Video ', ${unresolvedVideoExpr})) AS title,
                COALESCE(${artistExpr}, NULL) AS channelTitle,
                COALESCE(${favouritedExpr}, 0) AS favourited,
                COALESCE(${descriptionExpr}, 'Playlist track') AS description
              FROM playlistitems pi
              LEFT JOIN videos v ON ${joinCondition}
              WHERE pi.${playlistCol} = ?
              ORDER BY pi.${orderCol} ASC
            `,
            numericId,
          );

          const collapsed = collapseToPlaylistItems(fallbackRows);

          if (collapsed.length > 0) {
            videoRows = collapsed;
          }
        } catch {
          // Keep empty rows and return playlist shell below.
        }
      }
    }

    return {
      id: String(typeof playlist.id === "bigint" ? Number(playlist.id) : playlist.id),
      name: playlist.name ?? "Untitled Playlist",
      videos: videoRows.map((video) =>
        mapPlaylistVideo({
          playlistItemId: (video as RankedVideoRow & { playlistItemId: string }).playlistItemId,
          videoId: video.videoId,
          title: video.title,
          channelTitle: video.channelTitle,
          favourited: video.favourited,
          description: video.description,
        }),
      ),
    };
  } catch {
    return null;
  }
}

export async function createPlaylist(name: string, videoIds: string[] = [], userId?: number) {
  if (hasDatabaseUrl() && userId) {
    const now = new Date();

    let inserted = false;

    try {
      await prisma.$executeRaw`
        INSERT INTO playlistnames (userId, name, createdAt, updatedAt)
        VALUES (${userId}, ${name}, ${now}, ${now})
      `;
      inserted = true;
    } catch {
      // no-op, try alternative shape
    }

    if (!inserted) {
      try {
        await prisma.$executeRaw`
          INSERT INTO playlistnames (user_id, name, is_private)
          VALUES (${userId}, ${name}, ${false})
        `;
        inserted = true;
      } catch {
        // no-op, handled by final throw below
      }
    }

    if (!inserted) {
      throw new Error("Playlist insert failed for known playlistnames schemas.");
    }

    const insertedIdRows = await prisma.$queryRaw<Array<{ id: number | bigint }>>`
      SELECT LAST_INSERT_ID() AS id
    `;
    const createdId = insertedIdRows[0]?.id;
    const playlistId =
      typeof createdId === "bigint" ? Number(createdId) : createdId;

    if (!playlistId) {
      throw new Error("Playlist inserted but id could not be resolved.");
    }

    if (videoIds.length > 0) {
      const uniqueVideoIds = [...new Set(videoIds.filter(Boolean))].slice(0, 50);

      for (const videoId of uniqueVideoIds) {
        const normalizedVideoId = normalizeYouTubeVideoId(videoId) ?? videoId;
        let linked = false;

        try {
          await prisma.$executeRaw`
            INSERT INTO playlistitems (playlistId, videoId, createdAt, updatedAt)
            VALUES (${playlistId}, ${normalizedVideoId}, ${now}, ${now})
          `;
          linked = true;
        } catch {
          // Legacy shape not available in this environment; try additional known schemas below.
        }

        if (linked) {
          continue;
        }

        try {
          await prisma.$executeRaw`
            INSERT INTO playlistitems (playlistId, videoId)
            VALUES (${playlistId}, ${normalizedVideoId})
          `;
          linked = true;
        } catch {
          // Continue to modern schema attempts.
        }

        if (linked) {
          continue;
        }

        let videoPk: number | null = null;

        try {
          const videoRows = await prisma.$queryRaw<Array<{ id: number | bigint }>>`
            SELECT id
            FROM videos
            WHERE videoId = ${normalizedVideoId}
            LIMIT 1
          `;
          const resolvedId = videoRows[0]?.id;
          const parsedId =
            typeof resolvedId === "bigint"
              ? Number(resolvedId)
              : Number(resolvedId ?? NaN);
          if (Number.isInteger(parsedId)) {
            videoPk = parsedId;
          }
        } catch {
          videoPk = null;
        }

        if (videoPk === null) {
          continue;
        }

        try {
          await prisma.$executeRaw`
            INSERT INTO playlistitems (playlist_id, video_id, sort_order)
            VALUES (
              ${playlistId},
              ${videoPk},
              COALESCE((SELECT MAX(sort_order) + 1 FROM playlistitems WHERE playlist_id = ${playlistId}), 0)
            )
          `;
          linked = true;
        } catch {
          // Try final modern fallback.
        }

        if (linked) {
          continue;
        }

        try {
          await prisma.$executeRaw`
            INSERT INTO playlistitems (playlist_id, video_id)
            VALUES (${playlistId}, ${videoPk})
          `;
        } catch {
          // Keep base playlist creation successful even if one item linkage fails.
        }
      }
    }

    return {
      id: String(playlistId),
      name,
      videos: [],
    };
  }

  throw new Error("Playlist creation requires a configured database and authenticated user.");
}

export async function addPlaylistItem(playlistId: string, videoId: string, userId?: number) {
  if (hasDatabaseUrl() && userId) {
    const numericPlaylistId = Number(playlistId);
    const normalizedVideoId = normalizeYouTubeVideoId(videoId) ?? videoId;

    if (!Number.isInteger(numericPlaylistId)) {
      return null;
    }

    try {
      let ownerColumn: "userId" | "user_id" | null = null;

      try {
        const rows = await prisma.$queryRaw<Array<{ id: number | bigint }>>`
          SELECT id
          FROM playlistnames
          WHERE id = ${numericPlaylistId} AND userId = ${userId}
          LIMIT 1
        `;

        if (rows.length > 0) {
          ownerColumn = "userId";
        }
      } catch {
        // Try alternative schema below.
      }

      if (!ownerColumn) {
        try {
          const rows = await prisma.$queryRaw<Array<{ id: number | bigint }>>`
            SELECT id
            FROM playlistnames
            WHERE id = ${numericPlaylistId} AND user_id = ${userId}
            LIMIT 1
          `;

          if (rows.length > 0) {
            ownerColumn = "user_id";
          }
        } catch {
          // no-op
        }
      }

      if (!ownerColumn) {
        return null;
      }

      const existingPlaylist = await getPlaylistById(String(numericPlaylistId), userId);
      if (
        existingPlaylist?.videos.some((video) => {
          const existingNormalizedId = normalizeYouTubeVideoId(video.id) ?? video.id;
          return existingNormalizedId === normalizedVideoId;
        })
      ) {
        return existingPlaylist;
      }

      const now = new Date();
      let inserted = false;

      const legacyAttempts: Array<() => Promise<number>> = [
        async () =>
          Number(
            await prisma.$executeRaw`
              INSERT INTO playlistitems (playlistId, videoId, createdAt, updatedAt)
              VALUES (${numericPlaylistId}, ${normalizedVideoId}, ${now}, ${now})
            `,
          ),
        async () =>
          Number(
            await prisma.$executeRaw`
              INSERT INTO playlistitems (playlistId, videoId)
              VALUES (${numericPlaylistId}, ${normalizedVideoId})
            `,
          ),
      ];

      for (const attempt of legacyAttempts) {
        try {
          const changed = await attempt();
          if (changed > 0) {
            inserted = true;
            break;
          }
        } catch {
          // Try next known insert shape.
        }
      }

      if (!inserted) {
        let videoPk: number | null = null;

        try {
          const videoRows = await prisma.$queryRaw<Array<{ id: number | bigint }>>`
            SELECT id
            FROM videos
            WHERE videoId = ${normalizedVideoId}
            LIMIT 1
          `;
          const resolvedId = videoRows[0]?.id;
          videoPk =
            typeof resolvedId === "bigint"
              ? Number(resolvedId)
              : Number(resolvedId ?? NaN);

          if (!Number.isInteger(videoPk)) {
            videoPk = null;
          }
        } catch {
          videoPk = null;
        }

        if (videoPk !== null) {
          const modernAttempts: Array<() => Promise<number>> = [
            async () =>
              Number(
                await prisma.$executeRaw`
                  INSERT INTO playlistitems (playlist_id, video_id, sort_order)
                  VALUES (
                    ${numericPlaylistId},
                    ${videoPk},
                    COALESCE((SELECT MAX(sort_order) + 1 FROM playlistitems WHERE playlist_id = ${numericPlaylistId}), 0)
                  )
                `,
              ),
            async () =>
              Number(
                await prisma.$executeRaw`
                  INSERT INTO playlistitems (playlist_id, video_id)
                  VALUES (${numericPlaylistId}, ${videoPk})
                `,
              ),
          ];

          for (const attempt of modernAttempts) {
            try {
              const changed = await attempt();
              if (changed > 0) {
                inserted = true;
                break;
              }
            } catch {
              // Try next known insert shape.
            }
          }
        }
      }

      if (!inserted) {
        return null;
      }

      const resolvedPlaylist = await getPlaylistById(String(numericPlaylistId), userId);

      if (resolvedPlaylist) {
        return resolvedPlaylist;
      }

      const fallbackRows =
        ownerColumn === "userId"
          ? await prisma.$queryRaw<Array<{ id: number | bigint; name: string | null }>>`
              SELECT id, name
              FROM playlistnames
              WHERE id = ${numericPlaylistId} AND userId = ${userId}
              LIMIT 1
            `
          : await prisma.$queryRaw<Array<{ id: number | bigint; name: string | null }>>`
              SELECT id, name
              FROM playlistnames
              WHERE id = ${numericPlaylistId} AND user_id = ${userId}
              LIMIT 1
            `;

      const fallback = fallbackRows[0];

      if (!fallback) {
        return null;
      }

      return {
        id: String(typeof fallback.id === "bigint" ? Number(fallback.id) : fallback.id),
        name: fallback.name ?? "Untitled Playlist",
        videos: [],
      };
    } catch {
      return null;
    }
  }

  return null;
}

export async function addPlaylistItems(
  playlistId: string,
  videoIds: string[],
  userId?: number,
) {
  if (!hasDatabaseUrl() || !userId) {
    return null;
  }

  const numericPlaylistId = Number(playlistId);

  if (!Number.isInteger(numericPlaylistId)) {
    return null;
  }

  try {
    let ownerColumn: "userId" | "user_id" | null = null;

    try {
      const rows = await prisma.$queryRaw<Array<{ id: number | bigint }>>`
        SELECT id
        FROM playlistnames
        WHERE id = ${numericPlaylistId} AND userId = ${userId}
        LIMIT 1
      `;

      if (rows.length > 0) {
        ownerColumn = "userId";
      }
    } catch {
      // Try alternative schema below.
    }

    if (!ownerColumn) {
      try {
        const rows = await prisma.$queryRaw<Array<{ id: number | bigint }>>`
          SELECT id
          FROM playlistnames
          WHERE id = ${numericPlaylistId} AND user_id = ${userId}
          LIMIT 1
        `;

        if (rows.length > 0) {
          ownerColumn = "user_id";
        }
      } catch {
        // no-op
      }
    }

    if (!ownerColumn) {
      return null;
    }

    const existingPlaylist = await getPlaylistById(String(numericPlaylistId), userId);
    const existingIds = new Set(
      (existingPlaylist?.videos ?? []).map(
        (video) => normalizeYouTubeVideoId(video.id) ?? video.id,
      ),
    );

    const uniqueVideoIds = [
      ...new Set(
        videoIds
          .map((id) => normalizeYouTubeVideoId(id) ?? id)
          .filter(Boolean),
      ),
    ].filter((id) => !existingIds.has(id));

    const now = new Date();

    for (const normalizedVideoId of uniqueVideoIds) {
      let linked = false;

      const legacyAttempts: Array<() => Promise<number>> = [
        async () =>
          Number(
            await prisma.$executeRaw`
              INSERT INTO playlistitems (playlistId, videoId, createdAt, updatedAt)
              VALUES (${numericPlaylistId}, ${normalizedVideoId}, ${now}, ${now})
            `,
          ),
        async () =>
          Number(
            await prisma.$executeRaw`
              INSERT INTO playlistitems (playlistId, videoId)
              VALUES (${numericPlaylistId}, ${normalizedVideoId})
            `,
          ),
      ];

      for (const attempt of legacyAttempts) {
        try {
          const changed = await attempt();
          if (changed > 0) {
            linked = true;
            break;
          }
        } catch {
          // Try next known insert shape.
        }
      }

      if (linked) {
        continue;
      }

      let videoPk: number | null = null;

      try {
        const videoRows = await prisma.$queryRaw<Array<{ id: number | bigint }>>`
          SELECT id
          FROM videos
          WHERE videoId = ${normalizedVideoId}
          LIMIT 1
        `;
        const resolvedId = videoRows[0]?.id;
        const parsedId =
          typeof resolvedId === "bigint"
            ? Number(resolvedId)
            : Number(resolvedId ?? NaN);
        if (Number.isInteger(parsedId)) {
          videoPk = parsedId;
        }
      } catch {
        videoPk = null;
      }

      if (videoPk === null) {
        continue;
      }

      const modernAttempts: Array<() => Promise<number>> = [
        async () =>
          Number(
            await prisma.$executeRaw`
              INSERT INTO playlistitems (playlist_id, video_id, sort_order)
              VALUES (
                ${numericPlaylistId},
                ${videoPk},
                COALESCE((SELECT MAX(sort_order) + 1 FROM playlistitems WHERE playlist_id = ${numericPlaylistId}), 0)
              )
            `,
          ),
        async () =>
          Number(
            await prisma.$executeRaw`
              INSERT INTO playlistitems (playlist_id, video_id)
              VALUES (${numericPlaylistId}, ${videoPk})
            `,
          ),
      ];

      for (const attempt of modernAttempts) {
        try {
          const changed = await attempt();
          if (changed > 0) {
            linked = true;
            break;
          }
        } catch {
          // Try next known insert shape.
        }
      }
    }

    const resolvedPlaylist = await getPlaylistById(String(numericPlaylistId), userId);

    if (resolvedPlaylist) {
      return resolvedPlaylist;
    }

    const fallbackRows =
      ownerColumn === "userId"
        ? await prisma.$queryRaw<Array<{ id: number | bigint; name: string | null }>>`
            SELECT id, name
            FROM playlistnames
            WHERE id = ${numericPlaylistId} AND userId = ${userId}
            LIMIT 1
          `
        : await prisma.$queryRaw<Array<{ id: number | bigint; name: string | null }>>`
            SELECT id, name
            FROM playlistnames
            WHERE id = ${numericPlaylistId} AND user_id = ${userId}
            LIMIT 1
          `;

    const fallback = fallbackRows[0];

    if (!fallback) {
      return null;
    }

    return {
      id: String(typeof fallback.id === "bigint" ? Number(fallback.id) : fallback.id),
      name: fallback.name ?? "Untitled Playlist",
      videos: [],
    };
  } catch {
    return null;
  }
}

export async function removePlaylistItem(
  playlistId: string,
  playlistItemIndex: number | null,
  userId?: number,
  playlistItemId?: string | null,
) {
  if (!hasDatabaseUrl() || !userId) {
    return null;
  }

  const numericPlaylistId = Number(playlistId);

  if (
    !Number.isInteger(numericPlaylistId) ||
    ((playlistItemId == null || playlistItemId.length === 0) &&
      (!Number.isInteger(playlistItemIndex) || (playlistItemIndex ?? -1) < 0))
  ) {
    return null;
  }

  try {
    let ownerColumn: "userId" | "user_id" | null = null;

    try {
      const rows = await prisma.$queryRaw<Array<{ id: number | bigint }>>`
        SELECT id
        FROM playlistnames
        WHERE id = ${numericPlaylistId} AND userId = ${userId}
        LIMIT 1
      `;

      if (rows.length > 0) {
        ownerColumn = "userId";
      }
    } catch {
      // Try mapped owner column below.
    }

    if (!ownerColumn) {
      try {
        const rows = await prisma.$queryRaw<Array<{ id: number | bigint }>>`
          SELECT id
          FROM playlistnames
          WHERE id = ${numericPlaylistId} AND user_id = ${userId}
          LIMIT 1
        `;

        if (rows.length > 0) {
          ownerColumn = "user_id";
        }
      } catch {
        // no-op
      }
    }

    if (!ownerColumn) {
      return null;
    }

    const playlistColumns = await loadTableColumns("playlistitems");
    const playlistRef = pickColumn(playlistColumns, ["playlist_id", "playlistId", "playlistid"]);
    const rowIdRef = pickColumn(playlistColumns, ["id"]);
    const orderRef = pickColumn(playlistColumns, [
      "sort_order",
      "sortOrder",
      "display_order",
      "displayOrder",
      "order_index",
      "orderIndex",
      "position",
      "sequence",
      "idx",
      "id",
    ]);

    if (!playlistRef || !rowIdRef || !orderRef) {
      return null;
    }

    const playlistCol = escapeSqlIdentifier(playlistRef.Field);
    const rowIdCol = escapeSqlIdentifier(rowIdRef.Field);
    const orderCol = escapeSqlIdentifier(orderRef.Field);

    const itemRows = await prisma.$queryRawUnsafe<Array<{ rowId: number | bigint }>>(
      `
        SELECT pi.${rowIdCol} AS rowId
        FROM playlistitems pi
        WHERE pi.${playlistCol} = ?
        ORDER BY pi.${orderCol} ASC, pi.${rowIdCol} ASC
      `,
      numericPlaylistId,
    );

    const target = playlistItemId
      ? itemRows.find(
          (row) =>
            String(
              typeof row.rowId === "bigint" ? row.rowId.toString() : row.rowId,
            ) === playlistItemId,
        )
      : itemRows[playlistItemIndex ?? -1];

    if (!target) {
      return null;
    }

    await prisma.$executeRawUnsafe(
      `DELETE FROM playlistitems WHERE ${rowIdCol} = ? LIMIT 1`,
      typeof target.rowId === "bigint" ? Number(target.rowId) : target.rowId,
    );

    return await getPlaylistById(String(numericPlaylistId), userId);
  } catch {
    return null;
  }
}

export async function reorderPlaylistItems(
  playlistId: string,
  fromIndex: number | null,
  toIndex: number | null,
  userId?: number,
  fromPlaylistItemId?: string | null,
  toPlaylistItemId?: string | null,
) {
  if (!hasDatabaseUrl() || !userId) {
    return null;
  }

  const numericPlaylistId = Number(playlistId);

  if (
    !Number.isInteger(numericPlaylistId) ||
    ((fromPlaylistItemId == null ||
      fromPlaylistItemId.length === 0 ||
      toPlaylistItemId == null ||
      toPlaylistItemId.length === 0) &&
      (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)))
  ) {
    return null;
  }

  if (
    (fromPlaylistItemId == null ||
      fromPlaylistItemId.length === 0 ||
      toPlaylistItemId == null ||
      toPlaylistItemId.length === 0) &&
    ((fromIndex ?? -1) < 0 || (toIndex ?? -1) < 0)
  ) {
    return null;
  }

  if (
    (fromPlaylistItemId &&
      toPlaylistItemId &&
      fromPlaylistItemId === toPlaylistItemId) ||
    (fromIndex !== null && toIndex !== null && fromIndex === toIndex)
  ) {
    return await getPlaylistById(String(numericPlaylistId), userId);
  }

  try {
    let ownerColumn: "userId" | "user_id" | null = null;

    try {
      const rows = await prisma.$queryRaw<Array<{ id: number | bigint }>>`
        SELECT id
        FROM playlistnames
        WHERE id = ${numericPlaylistId} AND userId = ${userId}
        LIMIT 1
      `;

      if (rows.length > 0) {
        ownerColumn = "userId";
      }
    } catch {
      // Try mapped owner column below.
    }

    if (!ownerColumn) {
      try {
        const rows = await prisma.$queryRaw<Array<{ id: number | bigint }>>`
          SELECT id
          FROM playlistnames
          WHERE id = ${numericPlaylistId} AND user_id = ${userId}
          LIMIT 1
        `;

        if (rows.length > 0) {
          ownerColumn = "user_id";
        }
      } catch {
        // no-op
      }
    }

    if (!ownerColumn) {
      return null;
    }

    const playlistColumns = await loadTableColumns("playlistitems");
    const playlistRef = pickColumn(playlistColumns, ["playlist_id", "playlistId", "playlistid"]);
    const rowIdRef = pickColumn(playlistColumns, ["id"]);
    const orderRef = pickColumn(playlistColumns, [
      "sort_order",
      "sortOrder",
      "display_order",
      "displayOrder",
      "order_index",
      "orderIndex",
      "position",
      "sequence",
      "idx",
      "id",
    ]);

    if (!playlistRef || !rowIdRef || !orderRef) {
      return null;
    }

    // Reordering requires a mutable ordering column.
    if (orderRef.Field === "id") {
      return null;
    }

    const playlistCol = escapeSqlIdentifier(playlistRef.Field);
    const rowIdCol = escapeSqlIdentifier(rowIdRef.Field);
    const orderCol = escapeSqlIdentifier(orderRef.Field);

    const itemRows = await prisma.$queryRawUnsafe<Array<{ rowId: number | bigint }>>(
      `
        SELECT pi.${rowIdCol} AS rowId
        FROM playlistitems pi
        WHERE pi.${playlistCol} = ?
        ORDER BY pi.${orderCol} ASC, pi.${rowIdCol} ASC
      `,
      numericPlaylistId,
    );

    const resolvedFromIndex = fromPlaylistItemId
      ? itemRows.findIndex(
          (row) =>
            String(
              typeof row.rowId === "bigint" ? row.rowId.toString() : row.rowId,
            ) === fromPlaylistItemId,
        )
      : (fromIndex ?? -1);
    const resolvedToIndex = toPlaylistItemId
      ? itemRows.findIndex(
          (row) =>
            String(
              typeof row.rowId === "bigint" ? row.rowId.toString() : row.rowId,
            ) === toPlaylistItemId,
        )
      : (toIndex ?? -1);

    if (
      resolvedFromIndex < 0 ||
      resolvedToIndex < 0 ||
      resolvedFromIndex >= itemRows.length ||
      resolvedToIndex >= itemRows.length
    ) {
      return null;
    }

    const reordered = [...itemRows];
    const [moved] = reordered.splice(resolvedFromIndex, 1);

    if (!moved) {
      return null;
    }

    reordered.splice(resolvedToIndex, 0, moved);

    // Two-phase update avoids collisions when ordering column is unique/indexed.
    const tempOffset = reordered.length + 1024;

    for (let index = 0; index < reordered.length; index += 1) {
      const rowId = reordered[index]?.rowId;

      if (rowId === undefined || rowId === null) {
        continue;
      }

      const normalizedRowId = typeof rowId === "bigint" ? Number(rowId) : rowId;
      await prisma.$executeRawUnsafe(
        `UPDATE playlistitems SET ${orderCol} = ? WHERE ${rowIdCol} = ? LIMIT 1`,
        tempOffset + index,
        normalizedRowId,
      );
    }

    for (let index = 0; index < reordered.length; index += 1) {
      const rowId = reordered[index]?.rowId;

      if (rowId === undefined || rowId === null) {
        continue;
      }

      const normalizedRowId = typeof rowId === "bigint" ? Number(rowId) : rowId;
      await prisma.$executeRawUnsafe(
        `UPDATE playlistitems SET ${orderCol} = ? WHERE ${rowIdCol} = ? LIMIT 1`,
        index,
        normalizedRowId,
      );
    }

    return await getPlaylistById(String(numericPlaylistId), userId);
  } catch {
    return null;
  }
}

export async function renamePlaylist(playlistId: string, name: string, userId?: number) {
  if (hasDatabaseUrl() && userId) {
    const numericId = Number(playlistId);
    const trimmedName = name.trim();

    if (!Number.isInteger(numericId) || trimmedName.length < 2) {
      return false;
    }

    const now = new Date();

    try {
      const attempts: Array<() => Promise<number>> = [
        async () =>
          Number(
            await prisma.$executeRaw`
              UPDATE playlistnames
              SET name = ${trimmedName}, updatedAt = ${now}
              WHERE id = ${numericId} AND userId = ${userId}
            `,
          ),
        async () =>
          Number(
            await prisma.$executeRaw`
              UPDATE playlistnames
              SET name = ${trimmedName}
              WHERE id = ${numericId} AND userId = ${userId}
            `,
          ),
        async () =>
          Number(
            await prisma.$executeRaw`
              UPDATE playlistnames
              SET name = ${trimmedName}, updatedAt = ${now}
              WHERE id = ${numericId} AND user_id = ${userId}
            `,
          ),
        async () =>
          Number(
            await prisma.$executeRaw`
              UPDATE playlistnames
              SET name = ${trimmedName}
              WHERE id = ${numericId} AND user_id = ${userId}
            `,
          ),
      ];

      for (const attempt of attempts) {
        try {
          const changed = await attempt();

          if (changed > 0) {
            return true;
          }
        } catch {
          // Try the next known schema shape.
        }
      }

      return false;
    } catch {
      return false;
    }
  }

  return false;
}

export async function deletePlaylist(playlistId: string, userId?: number) {
  if (hasDatabaseUrl() && userId) {
    const numericId = Number(playlistId);

    if (!Number.isInteger(numericId)) {
      return false;
    }

    try {
      let ownerColumn: "userId" | "user_id" | null = null;

      try {
        const rows = await prisma.$queryRaw<Array<{ id: number | bigint }>>`
          SELECT id
          FROM playlistnames
          WHERE id = ${numericId} AND userId = ${userId}
          LIMIT 1
        `;

        if (rows.length > 0) {
          ownerColumn = "userId";
        }
      } catch {
        // Try alternative schema below.
      }

      if (!ownerColumn) {
        try {
          const rows = await prisma.$queryRaw<Array<{ id: number | bigint }>>`
            SELECT id
            FROM playlistnames
            WHERE id = ${numericId} AND user_id = ${userId}
            LIMIT 1
          `;

          if (rows.length > 0) {
            ownerColumn = "user_id";
          }
        } catch {
          // no-op
        }
      }

      if (!ownerColumn) {
        return false;
      }

      try {
        await prisma.$executeRaw`
          DELETE FROM playlistitems
          WHERE playlistId = ${numericId}
        `;
      } catch {
        await prisma.$executeRaw`
          DELETE FROM playlistitems
          WHERE playlist_id = ${numericId}
        `;
      }

      const deleted =
        ownerColumn === "userId"
          ? await prisma.$executeRaw`
              DELETE FROM playlistnames
              WHERE id = ${numericId} AND userId = ${userId}
            `
          : await prisma.$executeRaw`
              DELETE FROM playlistnames
              WHERE id = ${numericId} AND user_id = ${userId}
            `;

      return Number(deleted) > 0;
    } catch {
      return false;
    }
  }

  return false;
}
