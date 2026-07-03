import type { ReactNode } from "react";
import { MobilePlayerProvider } from "@/components/mobile/mobile-player-context";
import { MobileShell } from "@/components/mobile/mobile-shell";

export const dynamic = "force-dynamic";

export default function MobileLayout({ children }: { children: ReactNode }) {
  return (
    <MobilePlayerProvider>
      <MobileShell>{children}</MobileShell>
    </MobilePlayerProvider>
  );
}
