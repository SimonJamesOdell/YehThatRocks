import { cookies } from "next/headers";

import { ACCESS_TOKEN_COOKIE } from "@/lib/auth-config";
import { CloseLink } from "@/components/close-link";
import { Top100VideoLink } from "@/components/top100-video-link";
import { getTopVideos } from "@/lib/catalog-data";

export default async function TopHundredPage() {
  const cookieStore = await cookies();
  const isAuthenticated = Boolean(cookieStore.get(ACCESS_TOKEN_COOKIE)?.value);
  const topVideos = await getTopVideos(100);

  return (
    <>
      <div className="favouritesBlindBar">
        <strong>Top 100</strong>
        <CloseLink />
      </div>

      <div className="trackStack spanTwoColumns">
        {topVideos.map((track, index) => (
          <Top100VideoLink key={track.id} track={track} index={index} isAuthenticated={isAuthenticated} />
        ))}
      </div>
    </>
  );
}
