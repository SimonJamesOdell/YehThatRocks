import { cookies } from "next/headers";

import { ACCESS_TOKEN_COOKIE } from "@/lib/auth-config";
import { CloseLink } from "@/components/close-link";
import { NewScrollReset } from "@/components/new-scroll-reset";
import { NewVideosLoader } from "@/components/new-videos-loader";
import { getNewestVideos } from "@/lib/catalog-data";

export default async function NewPage() {
  const cookieStore = await cookies();
  const isAuthenticated = Boolean(cookieStore.get(ACCESS_TOKEN_COOKIE)?.value);
  const initialVideos = await getNewestVideos(10);

  return (
    <>
      <NewScrollReset />

      <div className="favouritesBlindBar">
        <strong><span style={{filter: "brightness(0) invert(1)"}}>⭐</span> New</strong>
        <CloseLink />
      </div>

      <NewVideosLoader initialVideos={initialVideos} isAuthenticated={isAuthenticated} />
    </>
  );
}