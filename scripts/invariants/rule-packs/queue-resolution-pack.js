function applyQueueResolutionRulePack({
  shellDynamicSource,
  playerExperienceSource,
  temporaryQueueControllerHookSource,
  nextTrackDecisionHookSource,
  playerNextTrackDomainSource,
  queueDomainSource,
  playlistDomainSource,
  playerEventsSource,
  assertContains,
  failures,
}) {
  assertContains(shellDynamicSource, "type RightRailMode = \"watch-next\" | \"playlist\" | \"queue\";", "Shell supports queue mode in right rail tab state", failures);
  assertContains(shellDynamicSource, "import { useTemporaryQueueController } from \"@/components/use-temporary-queue-controller\";", "Shell delegates queue orchestration into dedicated hook", failures);

  assertContains(temporaryQueueControllerHookSource, "export function useTemporaryQueueController", "Temporary queue hook exists", failures);
  assertContains(temporaryQueueControllerHookSource, "import { mutateTemporaryQueue as mutateTemporaryQueueDomain, type QueueMutation } from \"@/domains/queue/temporary-queue\";", "Temporary queue hook uses queue domain mutation API", failures);
  assertContains(queueDomainSource, "export type QueueMutation =", "Queue domain defines explicit mutation API type", failures);
  assertContains(queueDomainSource, "type: \"remove\"; videoId: string; reason: QueueRemovalReason", "Queue domain remove mutation carries explicit reason enum", failures);
  assertContains(temporaryQueueControllerHookSource, "const mutateTemporaryQueue = useCallback((mutation: QueueMutation) => {", "Temporary queue hook centralizes queue mutations", failures);
  assertContains(temporaryQueueControllerHookSource, "setTemporaryQueueVideos((currentQueue) => mutateTemporaryQueueDomain(currentQueue, mutation));", "Temporary queue hook delegates mutation behavior to queue domain", failures);
  assertContains(temporaryQueueControllerHookSource, "window.addEventListener(VIDEO_ENDED_EVENT", "Temporary queue hook consumes ended-video events", failures);
  assertContains(temporaryQueueControllerHookSource, "window.addEventListener(TEMP_QUEUE_DEQUEUE_EVENT", "Temporary queue hook consumes manual dequeue events", failures);
  assertContains(temporaryQueueControllerHookSource, "const previousVideoIdRef = useRef(currentVideoId);", "Temporary queue hook tracks previous video id", failures);
  assertContains(temporaryQueueControllerHookSource, "reason: \"transition-sync\"", "Temporary queue transition cleanup uses transition-sync reason", failures);

  assertContains(playerExperienceSource, "import { useNextTrackDecision } from \"@/components/use-next-track-decision\";", "Player delegates next-target orchestration into hook", failures);
  assertContains(playerExperienceSource, "import { EVENT_NAMES, dispatchAppEvent, listenToAppEvent", "Player consumes centralized event contract", failures);
  assertContains(nextTrackDecisionHookSource, "export function useNextTrackDecision", "Next-track decision hook exists", failures);
  assertContains(nextTrackDecisionHookSource, "import {", "Next-track hook imports domain functions", failures);
  assertContains(nextTrackDecisionHookSource, "resolveNextTrackTarget,", "Next-track hook delegates next-target resolution to player domain", failures);
  assertContains(nextTrackDecisionHookSource, "resolvePlaylistStepTarget as resolvePlaylistStepTargetDomain", "Next-track hook delegates playlist stepping to playlist domain", failures);
  assertContains(playerNextTrackDomainSource, "const priorityMachine", "Player domain models explicit next-track priority machine", failures);
  assertContains(playerNextTrackDomainSource, "state: \"playlist\"", "Player domain keeps playlist as highest priority", failures);
  assertContains(playerNextTrackDomainSource, "state: \"temporary-queue\"", "Player domain keeps temporary queue as second priority", failures);
  assertContains(playerNextTrackDomainSource, "state: \"route-queue\"", "Player domain keeps route queue as third priority", failures);
  assertContains(playerNextTrackDomainSource, "state: \"random-fallback\"", "Player domain keeps random fallback as final priority", failures);
  assertContains(queueDomainSource, "const currentQueueIndex = temporaryQueue.findIndex((video) => video.id === currentVideoId);", "Queue domain resolves current queue index", failures);
  assertContains(queueDomainSource, "? (temporaryQueue[currentQueueIndex + 1]?.id ?? null)", "Queue domain advances to next queue slot", failures);
  assertContains(queueDomainSource, ": (temporaryQueue[0]?.id ?? null);", "Queue domain falls back to queue head", failures);
  assertContains(playlistDomainSource, "export function resolvePlaylistStepTarget", "Playlist domain exposes playlist step resolver", failures);

  assertContains(playerExperienceSource, "if (currentVideoWasQueued && nextTarget.videoId !== currentVideo.id) {", "Manual Next only dequeues when transition is real", failures);
  assertContains(playerExperienceSource, "window.dispatchEvent(new CustomEvent(TEMP_QUEUE_DEQUEUE_EVENT, {", "Manual Next dispatches queue dequeue event", failures);
  assertContains(playerExperienceSource, "reason: \"manual-next\"", "Manual Next queue dequeue event includes manual-next reason", failures);
  assertContains(playerExperienceSource, "window.dispatchEvent(new CustomEvent(VIDEO_ENDED_EVENT, {", "ENDED state dispatches queue consumption event", failures);
  assertContains(playerExperienceSource, "reason: \"ended\"", "ENDED queue dequeue event includes ended reason", failures);

  assertContains(playerEventsSource, 'export { VIDEO_ENDED_EVENT, TEMP_QUEUE_DEQUEUE_EVENT } from "@/lib/events-contract";', "Player events module re-exports queue events", failures);
}

module.exports = {
  applyQueueResolutionRulePack,
};
