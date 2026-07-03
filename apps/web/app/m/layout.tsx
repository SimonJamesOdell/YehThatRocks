import type { ReactNode } from "react";
import { MobilePlayerProvider } from "./_components/mobile-player-context";
import { MobileShell } from "./_components/mobile-shell";

export const dynamic = "force-dynamic";

export default function MobileLayout({ children }: { children: ReactNode }) {
  return (
    <MobilePlayerProvider>
      <MobileShell>{children}</MobileShell>
    </MobilePlayerProvider>
  );
}
