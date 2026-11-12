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
    const { authState, user, hasRefreshToken } = await getShellRequestAuthState();
    if (authState.status === "authenticated" && user) {
      return {
        isLoggedIn: true,
        userId: user.id,
        screenName: user.screenName,
        checked: true,
      };
    }
    // A returning user whose access token has expired still holds a refresh
    // token — keep them logged in and let the client shell silently renew the
    // access token, rather than flashing a logged-out state.
    if (authState.status === "unavailable" && !hasRefreshToken) {
      // Auth unavailable and no session cookie — fall back to client-side check
      return undefined;
    }
    return {
      isLoggedIn: hasRefreshToken,
      userId: null,
      screenName: null,
      checked: true,
    };
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
