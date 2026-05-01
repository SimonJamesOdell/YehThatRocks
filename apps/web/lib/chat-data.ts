/**
 * chat-data.ts
 * Data-layer for the chat system: schema introspection, online presence,
 * message reads and writes. Route handlers use these functions and stay
 * thin (auth, CSRF, rate-limit, response wrapping only).
 */

import { prisma } from "@/lib/db";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ChatMessageRow = {
  id: number;
  userId: number | null;
  content: string;
  createdAt: Date | string | null;
  room: string | null;
  videoId: string | null;
};

export type MessageColumnMap = {
  id: string;
  userId: string;
  room: string;
  videoId: string;
  content: string;
  createdAt: string;
  updatedAt?: string;
};

export type OnlineColumnMap = {
  userId: string;
  lastSeen: string;
  lastSeenType: "epoch" | "datetime";
  createdAt?: string;
  updatedAt?: string;
};

type OnlinePresenceRow = {
  userId: number | null;
  lastSeen: number | Date | null;
};

type ChatUser = {
  id: number;
  screenName: string | null;
  email: string | null;
  avatarUrl: string | null;
};

export type MappedChatMessage = {
  id: number;
  content: string;
  createdAt: string | null;
  room: string;
  videoId: string | null;
  user: {
    id: number | null;
    name: string;
    avatarUrl: string | null;
  };
};

export type OnlineUser = {
  id: number;
  name: string;
  avatarUrl: string | null;
  lastSeen: string | null;
};

// ── Schema introspection (cached) ─────────────────────────────────────────────

const ONLINE_PRESENCE_TOUCH_INTERVAL_MS = 45_000;
const ONLINE_PRESENCE_TOUCH_CACHE_TTL_MS = 5 * 60_000;

let cachedMessageColumns: MessageColumnMap | null = null;
let cachedOnlineColumns: OnlineColumnMap | null = null;
let cachedMessageColumnsPromise: Promise<MessageColumnMap> | null = null;
let cachedOnlineColumnsPromise: Promise<OnlineColumnMap> | null = null;
const onlinePresenceTouchedAt = new Map<number, number>();

function escapeIdentifier(identifier: string) {
  return `\`${identifier.replace(/`/g, "``")}\``;
}

function getFirstAvailableColumn(available: Set<string>, candidates: string[]) {
  for (const candidate of candidates) {
    if (available.has(candidate)) {
      return candidate;
    }
  }

  return null;
}

export async function getMessageColumns(): Promise<MessageColumnMap> {
  if (cachedMessageColumns) {
    return cachedMessageColumns;
  }

  if (cachedMessageColumnsPromise) {
    return cachedMessageColumnsPromise;
  }

  cachedMessageColumnsPromise = (async () => {
    const columns = await prisma.$queryRawUnsafe<Array<{ Field: string }>>("SHOW COLUMNS FROM messages");
    const available = new Set(columns.map((column) => column.Field));

    const resolved: MessageColumnMap = {
      id: getFirstAvailableColumn(available, ["id"]) || "id",
      userId: getFirstAvailableColumn(available, ["user_id", "userid"]) || "userid",
      room: getFirstAvailableColumn(available, ["room", "type"]) || "type",
      videoId: getFirstAvailableColumn(available, ["video_id", "videoId"]) || "videoId",
      content: getFirstAvailableColumn(available, ["content", "message"]) || "message",
      createdAt: getFirstAvailableColumn(available, ["created_at", "createdAt"]) || "createdAt",
      updatedAt: getFirstAvailableColumn(available, ["updated_at", "updatedAt"]) || undefined,
    };

    cachedMessageColumns = resolved;
    return resolved;
  })().finally(() => {
    cachedMessageColumnsPromise = null;
  });

  return cachedMessageColumnsPromise;
}

async function getOnlineColumns(): Promise<OnlineColumnMap> {
  if (cachedOnlineColumns) {
    return cachedOnlineColumns;
  }

  if (cachedOnlineColumnsPromise) {
    return cachedOnlineColumnsPromise;
  }

  cachedOnlineColumnsPromise = (async () => {
    const columns = await prisma.$queryRawUnsafe<Array<{ Field: string; Type: string }>>("SHOW COLUMNS FROM online");
    const available = new Set(columns.map((column) => column.Field));
    const typeByField = new Map(columns.map((column) => [column.Field, column.Type.toLowerCase()]));

    const lastSeenColumn = getFirstAvailableColumn(available, ["last_seen", "lastSeen"]) || "lastSeen";
    const lastSeenTypeRaw = typeByField.get(lastSeenColumn) ?? "";
    const lastSeenType = /(date|time|timestamp)/i.test(lastSeenTypeRaw) ? "datetime" : "epoch";

    const resolved: OnlineColumnMap = {
      userId: getFirstAvailableColumn(available, ["user_id", "userid", "userId"]) || "userId",
      lastSeen: lastSeenColumn,
      lastSeenType,
      createdAt: getFirstAvailableColumn(available, ["created_at", "createdAt"]) || undefined,
      updatedAt: getFirstAvailableColumn(available, ["updated_at", "updatedAt"]) || undefined,
    };

    cachedOnlineColumns = resolved;
    return resolved;
  })().finally(() => {
    cachedOnlineColumnsPromise = null;
  });

  return cachedOnlineColumnsPromise;
}

// ── Online presence ───────────────────────────────────────────────────────────

function pruneOnlinePresenceTouchCache(now: number) {
  if (onlinePresenceTouchedAt.size < 500) {
    return;
  }

  for (const [cachedUserId, touchedAt] of onlinePresenceTouchedAt) {
    if (now - touchedAt > ONLINE_PRESENCE_TOUCH_CACHE_TTL_MS) {
      onlinePresenceTouchedAt.delete(cachedUserId);
    }
  }
}

async function touchOnlinePresence(userId: number) {
  const columns = await getOnlineColumns();
  const userIdCol = escapeIdentifier(columns.userId);
  const lastSeenCol = escapeIdentifier(columns.lastSeen);
  const nowExpr = columns.lastSeenType === "datetime" ? "UTC_TIMESTAMP(3)" : "UNIX_TIMESTAMP(UTC_TIMESTAMP())";

  const existing = await prisma.$queryRawUnsafe<Array<{ marker: number }>>(
    `
      SELECT 1 AS marker
      FROM online o
      WHERE o.${userIdCol} = ?
      LIMIT 1
    `,
    userId,
  );

  if (existing.length > 0) {
    const assignments = [`${lastSeenCol} = ${nowExpr}`];

    if (columns.updatedAt) {
      assignments.push(`${escapeIdentifier(columns.updatedAt)} = UTC_TIMESTAMP(3)`);
    }

    await prisma.$executeRawUnsafe(
      `
        UPDATE online
        SET ${assignments.join(", ")}
        WHERE ${userIdCol} = ?
      `,
      userId,
    );
    return;
  }

  const insertColumns = [userIdCol, lastSeenCol];
  const insertValues = ["?", nowExpr];

  if (columns.createdAt) {
    insertColumns.push(escapeIdentifier(columns.createdAt));
    insertValues.push("UTC_TIMESTAMP(3)");
  }

  if (columns.updatedAt) {
    insertColumns.push(escapeIdentifier(columns.updatedAt));
    insertValues.push("UTC_TIMESTAMP(3)");
  }

  await prisma.$executeRawUnsafe(
    `
      INSERT INTO online (${insertColumns.join(", ")})
      VALUES (${insertValues.join(", ")})
    `,
    userId,
  );
}

export async function touchOnlinePresenceThrottled(userId: number) {
  const now = Date.now();
  const lastTouchedAt = onlinePresenceTouchedAt.get(userId) ?? 0;

  if (now - lastTouchedAt < ONLINE_PRESENCE_TOUCH_INTERVAL_MS) {
    return;
  }

  await touchOnlinePresence(userId);
  onlinePresenceTouchedAt.set(userId, now);
  pruneOnlinePresenceTouchCache(now);
}

// ── Message helpers ───────────────────────────────────────────────────────────

// Internal-only mapper used by chat-data query/write helpers.
// Keep this non-exported to avoid accidental API coupling from routes.
function mapChatMessage(
  row: ChatMessageRow,
  userById: Map<number, ChatUser>,
): MappedChatMessage {
  const createdAtIso = (() => {
    if (!row.createdAt) {
      return null;
    }

    if (row.createdAt instanceof Date) {
      return row.createdAt.toISOString();
    }

    const parsed = new Date(row.createdAt);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  })();

  const user = row.userId ? userById.get(row.userId) : null;

  return {
    id: row.id,
    content: row.content,
    createdAt: createdAtIso,
    room: row.room ?? "global",
    videoId: row.videoId,
    user: {
      id: user?.id ?? null,
      name: user?.screenName?.trim() || "Anonymous",
      avatarUrl: user?.avatarUrl ?? null,
    },
  };
}

// ── Queries ───────────────────────────────────────────────────────────────────

export async function fetchChatMessages(
  mode: "global" | "video",
  videoId: string | undefined,
): Promise<MappedChatMessage[]> {
  const columns = await getMessageColumns();

  const idCol = escapeIdentifier(columns.id);
  const userIdCol = escapeIdentifier(columns.userId);
  const roomCol = escapeIdentifier(columns.room);
  const videoIdCol = escapeIdentifier(columns.videoId);
  const contentCol = escapeIdentifier(columns.content);
  const createdAtCol = escapeIdentifier(columns.createdAt);

  const whereSql =
    mode === "global"
      ? `((m.${roomCol} = ?) OR (m.${roomCol} IS NULL AND m.${videoIdCol} IS NULL))`
      : `(m.${roomCol} = ? AND m.${videoIdCol} = ?)`;

  const whereParams = mode === "global" ? ["global"] : ["video", videoId as string];

  const messages = await prisma.$queryRawUnsafe<ChatMessageRow[]>(
    `
      SELECT
        m.${idCol} AS id,
        m.${userIdCol} AS userId,
        m.${contentCol} AS content,
        m.${createdAtCol} AS createdAt,
        m.${roomCol} AS room,
        m.${videoIdCol} AS videoId
      FROM messages m
      WHERE ${whereSql}
      ORDER BY m.${createdAtCol} DESC, m.${idCol} DESC
      LIMIT 20
    `,
    ...whereParams,
  );

  const userIds = Array.from(
    new Set(messages.map((message) => Number(message.userId)).filter((value) => Number.isInteger(value) && value > 0)),
  );

  const users =
    userIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, screenName: true, email: true, avatarUrl: true },
        })
      : [];

  const userById = new Map(users.map((user) => [user.id, user]));
  return messages.reverse().map((row) => mapChatMessage(row, userById));
}

export async function fetchOnlineUsers(currentUserId: number): Promise<OnlineUser[]> {
  const columns = await getOnlineColumns();
  const userIdCol = escapeIdentifier(columns.userId);
  const lastSeenCol = escapeIdentifier(columns.lastSeen);
  const freshnessWindowSql =
    columns.lastSeenType === "datetime"
      ? `o.${lastSeenCol} >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 5 MINUTE)`
      : `o.${lastSeenCol} >= UNIX_TIMESTAMP(UTC_TIMESTAMP()) - 300`;

  const onlineRows = await prisma.$queryRawUnsafe<OnlinePresenceRow[]>(
    `
      SELECT
        o.${userIdCol} AS userId,
        o.${lastSeenCol} AS lastSeen
      FROM online o
      WHERE o.${userIdCol} IS NOT NULL
        AND o.${userIdCol} <> ?
        AND ${freshnessWindowSql}
      ORDER BY o.${lastSeenCol} DESC
      LIMIT 80
    `,
    currentUserId,
  );

  const userIds = Array.from(
    new Set(onlineRows.map((row) => Number(row.userId)).filter((value) => Number.isInteger(value) && value > 0)),
  );

  const users =
    userIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, screenName: true, email: true, avatarUrl: true },
        })
      : [];

  const userById = new Map(users.map((user) => [user.id, user]));

  return userIds
    .map((id) => {
      const user = userById.get(id);
      if (!user) {
        return null;
      }

      const presence = onlineRows.find((row) => Number(row.userId) === id);
      const rawLastSeen = presence?.lastSeen ?? null;
      const lastSeen =
        typeof rawLastSeen === "number"
          ? new Date(rawLastSeen * 1000).toISOString()
          : rawLastSeen instanceof Date
            ? rawLastSeen.toISOString()
            : null;

      return {
        id: user.id,
        name: user.screenName?.trim() || "Anonymous",
        avatarUrl: user.avatarUrl ?? null,
        lastSeen,
      };
    })
    .filter((value): value is OnlineUser => Boolean(value));
}

export async function insertChatMessage(params: {
  userId: number;
  mode: "global" | "video";
  videoId: string | undefined;
  content: string;
}): Promise<MappedChatMessage | null> {
  const columns = await getMessageColumns();

  const idCol = escapeIdentifier(columns.id);
  const userIdCol = escapeIdentifier(columns.userId);
  const roomCol = escapeIdentifier(columns.room);
  const videoIdCol = escapeIdentifier(columns.videoId);
  const contentCol = escapeIdentifier(columns.content);
  const createdAtCol = escapeIdentifier(columns.createdAt);
  const updatedAtCol = columns.updatedAt ? escapeIdentifier(columns.updatedAt) : null;

  const now = new Date();
  const insertColumns = [userIdCol, roomCol, videoIdCol, contentCol, createdAtCol];
  const insertValues: Array<string | number | Date | null> = [
    params.userId,
    params.mode,
    params.mode === "video" ? (params.videoId as string) : null,
    params.content,
    now,
  ];

  if (updatedAtCol) {
    insertColumns.push(updatedAtCol);
    insertValues.push(now);
  }

  await prisma.$executeRawUnsafe(
    `
      INSERT INTO messages (${insertColumns.join(", ")})
      VALUES (${insertColumns.map(() => "?").join(", ")})
    `,
    ...insertValues,
  );

  const created = await prisma.$queryRawUnsafe<ChatMessageRow[]>(
    `
      SELECT
        m.${idCol} AS id,
        m.${userIdCol} AS userId,
        m.${contentCol} AS content,
        m.${createdAtCol} AS createdAt,
        m.${roomCol} AS room,
        m.${videoIdCol} AS videoId
      FROM messages m
      WHERE m.${userIdCol} = ?
        AND m.${roomCol} = ?
        AND ((? IS NULL AND m.${videoIdCol} IS NULL) OR m.${videoIdCol} = ?)
        AND m.${contentCol} = ?
      ORDER BY m.${idCol} DESC
      LIMIT 1
    `,
    params.userId,
    params.mode,
    params.mode === "video" ? (params.videoId as string) : null,
    params.mode === "video" ? (params.videoId as string) : null,
    params.content,
  );

  const user = await prisma.user.findUnique({
    where: { id: params.userId },
    select: { id: true, screenName: true, email: true, avatarUrl: true },
  });

  const userById = new Map<number, ChatUser>();
  if (user) {
    userById.set(user.id, user);
  }

  const message = created[0];
  if (!message) {
    return null;
  }

  return mapChatMessage(message, userById);
}
