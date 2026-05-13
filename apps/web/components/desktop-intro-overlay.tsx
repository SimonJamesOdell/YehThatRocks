"use client";

import Image from "next/image";

type DesktopIntroOverlayProps = {
  isLogoReady: boolean;
  logoSrc: string;
};

export function DesktopIntroOverlay({
  isLogoReady,
  logoSrc,
}: DesktopIntroOverlayProps) {
  return (
    <div className="desktopIntroOverlay" aria-hidden="true">
      {isLogoReady ? (
        <Image
          src={logoSrc}
          alt=""
          width={306}
          height={93}
          priority
          unoptimized
          className="desktopIntroLogo"
        />
      ) : (
        <div className="playerBootLoader desktopIntroLoader" role="status" aria-live="polite" aria-label="Loading logo animation">
          <div className="playerBootBars" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </div>
          <p>Loading...</p>
        </div>
      )}
    </div>
  );
}
