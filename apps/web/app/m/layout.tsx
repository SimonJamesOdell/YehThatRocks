import type { ReactNode } from "react";
import { MobilePlayerProvider } from "@/components/mobile/mobile-player-context";
import { MobileShell } from "@/components/mobile/mobile-shell";
import { getShellRequestAuthState } from "@/lib/shell-request-state";

export const dynamic = "force-dynamic";

type MobileInitialAuth = {
  isLoggedIn: boolean;
  userId: number | null;
  screenName: string | null;
  checked: true;
};

async function resolveInitialAuth(): Promise<MobileInitialAuth | undefined> {
  try {
    const { authState, user } = await getShellRequestAuthState();
    if (authState.status === "authenticated" && user) {
      return {
        isLoggedIn: true,
        userId: user.id,
        screenName: user.screenName,
        checked: true,
      };
    }
    // Auth server responded but user is not authenticated — still pre-resolved
    if (authState.status !== "unavailable") {
      return {
        isLoggedIn: false,
        userId: null,
        screenName: null,
        checked: true,
      };
    }
    // Auth unavailable — fall back to client-side check
    return undefined;
  } catch {
    // Auth fetch failed — fall back to client-side check
    return undefined;
  }
}

export default async function MobileLayout({ children }: { children: ReactNode }) {
  const initialAuth = await resolveInitialAuth();

  return (
    <MobilePlayerProvider initialAuth={initialAuth}>
      <MobileShell>{children}</MobileShell>
    </MobilePlayerProvider>
  );
}
