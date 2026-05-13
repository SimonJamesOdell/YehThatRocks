import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import type { VideoRecord } from "@/lib/catalog";

type EndedChoiceRuntimeRefs = {
  endedChoiceUserScrolledRef: MutableRefObject<boolean>;
  endedChoiceFetchingRef: MutableRefObject<boolean>;
  endedChoiceHasMoreRef: MutableRefObject<boolean>;
  endedChoiceSkipRef: MutableRefObject<number>;
  endedChoiceAutoRetryBlockedUntilRef: MutableRefObject<number>;
  endedChoiceNoProgressStreakRef: MutableRefObject<number>;
  endedChoiceFailureStreakRef: MutableRefObject<number>;
  endedChoicePrewarmVideoIdRef: MutableRefObject<string | null>;
  endedChoicePostPrimeQueuedRef: MutableRefObject<boolean>;
};

type ResetEndedChoiceRuntimeStateOptions = {
  setEndedChoiceLoading: Dispatch<SetStateAction<boolean>>;
  setEndedChoiceRemoteVideos: Dispatch<SetStateAction<VideoRecord[]>>;
  setEndedChoiceAnimateCards: Dispatch<SetStateAction<boolean>>;
  refs: EndedChoiceRuntimeRefs;
};

export function resetEndedChoiceRuntimeState(options: ResetEndedChoiceRuntimeStateOptions) {
  options.setEndedChoiceLoading(false);
  options.setEndedChoiceRemoteVideos([]);
  options.setEndedChoiceAnimateCards(true);

  options.refs.endedChoiceUserScrolledRef.current = false;
  options.refs.endedChoiceFetchingRef.current = false;
  options.refs.endedChoiceHasMoreRef.current = true;
  options.refs.endedChoiceSkipRef.current = 0;
  options.refs.endedChoiceAutoRetryBlockedUntilRef.current = 0;
  options.refs.endedChoiceNoProgressStreakRef.current = 0;
  options.refs.endedChoiceFailureStreakRef.current = 0;
  options.refs.endedChoicePrewarmVideoIdRef.current = null;
  options.refs.endedChoicePostPrimeQueuedRef.current = false;
}

export function resetEndedChoiceRuntimeForReshuffle(options: {
  setEndedChoiceRemoteVideos: Dispatch<SetStateAction<VideoRecord[]>>;
  setEndedChoiceAnimateCards: Dispatch<SetStateAction<boolean>>;
  refs: EndedChoiceRuntimeRefs;
}) {
  options.setEndedChoiceRemoteVideos([]);
  options.setEndedChoiceAnimateCards(true);

  options.refs.endedChoiceUserScrolledRef.current = false;
  options.refs.endedChoiceHasMoreRef.current = true;
  options.refs.endedChoiceSkipRef.current = 0;
  options.refs.endedChoiceNoProgressStreakRef.current = 0;
  options.refs.endedChoiceFailureStreakRef.current = 0;
  options.refs.endedChoiceAutoRetryBlockedUntilRef.current = 0;
  options.refs.endedChoicePrewarmVideoIdRef.current = null;
  options.refs.endedChoicePostPrimeQueuedRef.current = false;
}

export function showEndedChoiceOverlayState(options: {
  setEndedChoiceLoading: Dispatch<SetStateAction<boolean>>;
  setShowEndedChoiceOverlay: Dispatch<SetStateAction<boolean>>;
  setShowControls: Dispatch<SetStateAction<boolean>>;
  setShowShareMenu: Dispatch<SetStateAction<boolean>>;
  withLoading?: boolean;
}) {
  if (options.withLoading !== false) {
    options.setEndedChoiceLoading(true);
  }

  options.setShowEndedChoiceOverlay(true);
  options.setShowControls(true);
  options.setShowShareMenu(false);
}
