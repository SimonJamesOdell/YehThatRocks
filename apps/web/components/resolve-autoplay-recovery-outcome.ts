export type AutoplayRecoveryOutcome =
  | { kind: "stale-request" }
  | { kind: "show-overlay" }
  | { kind: "stale-video" }
  | {
      kind: "navigate";
      videoId: string;
    };

export function resolveAutoplayRecoveryOutcome({
  requestId,
  currentRequestId,
  recoveredVideoId,
  endedVideoId,
  currentVideoId,
}: {
  requestId: number;
  currentRequestId: number;
  recoveredVideoId: string | null;
  endedVideoId: string;
  currentVideoId: string;
}): AutoplayRecoveryOutcome {
  if (requestId !== currentRequestId) {
    return { kind: "stale-request" };
  }

  if (!recoveredVideoId) {
    return { kind: "show-overlay" };
  }

  if (currentVideoId !== endedVideoId) {
    return { kind: "stale-video" };
  }

  return {
    kind: "navigate",
    videoId: recoveredVideoId,
  };
}
