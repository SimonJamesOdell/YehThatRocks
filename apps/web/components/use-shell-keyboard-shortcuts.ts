"use client";

import { useCallback, type KeyboardEvent as ReactKeyboardEvent } from "react";

type KeyboardActivateHandler = (event: ReactKeyboardEvent<HTMLElement>) => void;

export function useShellKeyboardShortcuts() {
  const handleButtonLikeKeyDown = useCallback((onActivate: () => void): KeyboardActivateHandler => {
    return (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onActivate();
      }
    };
  }, []);

  const handleStopPropagationKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    event.stopPropagation();
  }, []);

  return {
    handleButtonLikeKeyDown,
    handleStopPropagationKeyDown,
  };
}
