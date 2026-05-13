import { resolveAutoplayRecoveryOutcome } from "@/components/resolve-autoplay-recovery-outcome";
import { resolveAutoplayRecoveryTarget } from "@/components/resolve-autoplay-recovery-target";

export async function attemptAutoplayRecovery({
  requestId,
  endedVideoId,
  fallbackPoolSize,
  historyStack,
  getCurrentRequestId,
  getCurrentVideoId,
}: {
  requestId: number;
  endedVideoId: string;
  fallbackPoolSize: number;
  historyStack: string[];
  getCurrentRequestId: () => number;
  getCurrentVideoId: () => string;
}) {
  const recoveredVideoId = await resolveAutoplayRecoveryTarget({
    currentVideoId: getCurrentVideoId(),
    fallbackPoolSize,
    historyStack,
  });

  return resolveAutoplayRecoveryOutcome({
    requestId,
    currentRequestId: getCurrentRequestId(),
    recoveredVideoId,
    endedVideoId,
    currentVideoId: getCurrentVideoId(),
  });
}
