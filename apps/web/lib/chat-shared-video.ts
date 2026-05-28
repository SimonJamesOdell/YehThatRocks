const SHARED_VIDEO_MESSAGE_PREFIX = "__YTR_SHARE_VIDEO__:";
const ACTIVITY_MESSAGE_PREFIX = "__YTR_ACTIVITY__:";
const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const SHARED_VIDEO_FIELD_SEPARATOR = "\t";

type SharedVideoPayload = {
  videoId: string;
  title?: string;
  channelTitle?: string;
};

export type ActivityMessagePayload = {
  action: "favourited" | "playing";
  videoId: string;
  title?: string;
  channelTitle?: string;
};

function sanitizeField(value?: string) {
  if (!value) {
    return "";
  }

  return value
    .replace(/[\t\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function trimToLength(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return value.slice(0, maxLength).trimEnd();
}

export function buildSharedVideoMessage(videoId: string, title?: string, channelTitle?: string) {
  const normalizedVideoId = videoId.trim();
  if (!YOUTUBE_VIDEO_ID_PATTERN.test(normalizedVideoId)) {
    return "";
  }

  const sanitizedTitle = trimToLength(sanitizeField(title), 180);
  const sanitizedChannelTitle = trimToLength(sanitizeField(channelTitle), 120);

  return `${SHARED_VIDEO_MESSAGE_PREFIX}${normalizedVideoId}${SHARED_VIDEO_FIELD_SEPARATOR}${sanitizedTitle}${SHARED_VIDEO_FIELD_SEPARATOR}${sanitizedChannelTitle}`;
}

export function parseSharedVideoMessage(content: string) {
  const normalized = content.trim();
  if (!normalized.startsWith(SHARED_VIDEO_MESSAGE_PREFIX)) {
    return null;
  }

  const payload = normalized.slice(SHARED_VIDEO_MESSAGE_PREFIX.length);
  const [videoId, rawTitle = "", rawChannelTitle = ""] = payload.split(SHARED_VIDEO_FIELD_SEPARATOR);

  if (!YOUTUBE_VIDEO_ID_PATTERN.test(videoId)) {
    return null;
  }

  const title = sanitizeField(rawTitle);
  const channelTitle = sanitizeField(rawChannelTitle);

  return {
    videoId,
    title: title || undefined,
    channelTitle: channelTitle || undefined,
  } as SharedVideoPayload;
}

export function buildActivityMessage(
  action: "favourited" | "playing",
  videoId: string,
  title?: string,
  channelTitle?: string,
): string {
  const normalizedVideoId = videoId.trim();
  if (!YOUTUBE_VIDEO_ID_PATTERN.test(normalizedVideoId)) {
    return "";
  }

  const sanitizedTitle = trimToLength(sanitizeField(title), 180);
  const sanitizedChannelTitle = trimToLength(sanitizeField(channelTitle), 120);

  return `${ACTIVITY_MESSAGE_PREFIX}${action}${SHARED_VIDEO_FIELD_SEPARATOR}${normalizedVideoId}${SHARED_VIDEO_FIELD_SEPARATOR}${sanitizedTitle}${SHARED_VIDEO_FIELD_SEPARATOR}${sanitizedChannelTitle}`;
}

export function parseActivityMessage(content: string): ActivityMessagePayload | null {
  const normalized = content.trim();
  if (!normalized.startsWith(ACTIVITY_MESSAGE_PREFIX)) {
    return null;
  }

  const payload = normalized.slice(ACTIVITY_MESSAGE_PREFIX.length);
  const [action, videoId, rawTitle = "", rawChannelTitle = ""] = payload.split(SHARED_VIDEO_FIELD_SEPARATOR);

  if (!action || !videoId) {
    return null;
  }

  if (action !== "favourited" && action !== "playing") {
    return null;
  }

  if (!YOUTUBE_VIDEO_ID_PATTERN.test(videoId)) {
    return null;
  }

  const title = sanitizeField(rawTitle);
  const channelTitle = sanitizeField(rawChannelTitle);

  return {
    action,
    videoId,
    title: title || undefined,
    channelTitle: channelTitle || undefined,
  };
}
