import { cookies } from "next/headers";

import { ACCESS_TOKEN_COOKIE } from "@/lib/auth-config";
import { CloseLink } from "@/components/close-link";
import { Top100VideosLoader } from "@/components/top100-videos-loader";

export default async function TopHundredPage() {
  const cookieStore = await cookies();
  const isAuthenticated = Boolean(cookieStore.get(ACCESS_TOKEN_COOKIE)?.value);

  return (
    <>
      <div className="favouritesBlindBar">
        <strong>Top 100</strong>
        <CloseLink />
      </div>

      <Top100VideosLoader isAuthenticated={isAuthenticated} />
    </>
  );
}
