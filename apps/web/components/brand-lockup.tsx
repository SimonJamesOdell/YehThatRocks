"use client";

import Image from "next/image";
import Link from "next/link";
import type { Ref } from "react";

type BrandLockupProps = {
  logoRef?: Ref<HTMLAnchorElement>;
  onLogoClick: () => void;
};

export function BrandLockup({ logoRef, onLogoClick }: BrandLockupProps) {
  return (
    <div className="brandLockup">
      <Link href="/" aria-label="Yeh That Rocks home" ref={logoRef} onClick={onLogoClick}>
        <Image
          src="/assets/images/yeh_main_logo.png?v=20260424-4"
          alt="Yeh That Rocks"
          width={306}
          height={93}
          priority
          unoptimized
          className="brandLogo"
        />
      </Link>
      <h1 className="brandTagline">The world&apos;s loudest website</h1>
    </div>
  );
}
