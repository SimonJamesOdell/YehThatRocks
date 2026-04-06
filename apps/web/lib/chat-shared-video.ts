const SHARED_VIDEO_MESSAGE_PREFIX = "__YTR_SHARE_VIDEO__:";
const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export function buildSharedVideoMessage(videoId: string) {
  const normalizedVideoId = videoId.trim();
  if (!YOUTUBE_VIDEO_ID_PATTERN.test(normalizedVideoId)) {
    return "";
  }

  return `${SHARED_VIDEO_MESSAGE_PREFIX}${normalizedVideoId}`;
}

export function parseSharedVideoMessage(content: string) {
  const normalized = content.trim();
  if (!normalized.startsWith(SHARED_VIDEO_MESSAGE_PREFIX)) {
    return null;
  }

  const videoId = normalized.slice(SHARED_VIDEO_MESSAGE_PREFIX.length);
  if (!YOUTUBE_VIDEO_ID_PATTERN.test(videoId)) {
    return null;
  }

  return videoId;
}
