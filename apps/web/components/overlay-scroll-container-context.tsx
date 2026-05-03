"use client";

import { createContext, useContext, type ReactNode, type RefObject } from "react";

type OverlayScrollContainerContextValue = {
  overlayScrollContainerRef: RefObject<HTMLDivElement | null>;
};

const OverlayScrollContainerContext = createContext<OverlayScrollContainerContextValue | null>(null);

type OverlayScrollContainerProviderProps = {
  overlayScrollContainerRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
};

export function OverlayScrollContainerProvider({
  overlayScrollContainerRef,
  children,
}: OverlayScrollContainerProviderProps) {
  return (
    <OverlayScrollContainerContext.Provider value={{ overlayScrollContainerRef }}>
      {children}
    </OverlayScrollContainerContext.Provider>
  );
}

export function useOverlayScrollContainerRef() {
  const context = useContext(OverlayScrollContainerContext);
  return context?.overlayScrollContainerRef ?? null;
}
