"use client";

import Link from "next/link";

import { MobileCommunityToggle } from "@/components/mobile-community-toggle";
import { ShellNavItemContent } from "@/components/shell-nav-item-content";
import { isRouteActive } from "@/components/shell-dynamic-route-state";

type NavItem = {
  href: string;
  label: string;
};

type PrimaryNavProps = {
  items: NavItem[];
  pathname: string;
  getNavHref: (href: string) => string;
  onNavItemClick: (event: React.MouseEvent<HTMLAnchorElement>, item: NavItem, navHref: string) => void;
  shouldShowOverlayPanel: boolean;
  isMobileCommunityOpen: boolean;
  onToggleMobileCommunity: () => void;
};

export function PrimaryNav({
  items,
  pathname,
  getNavHref,
  onNavItemClick,
  shouldShowOverlayPanel,
  isMobileCommunityOpen,
  onToggleMobileCommunity,
}: PrimaryNavProps) {
  return (
    <nav className="mainNav" aria-label="Primary">
      {items.map((item) => {
        const isActive = isRouteActive(item.href, pathname);
        const navHref = getNavHref(item.href);
        return (
          <Link
            key={item.href}
            href={navHref}
            prefetch={false}
            className={isActive ? "navLink navLinkActive" : "navLink"}
            onClick={(event) => onNavItemClick(event, item, navHref)}
          >
            <ShellNavItemContent href={item.href} label={item.label} />
          </Link>
        );
      })}
      {!shouldShowOverlayPanel ? (
        <MobileCommunityToggle
          isOpen={isMobileCommunityOpen}
          onToggle={onToggleMobileCommunity}
        />
      ) : null}
    </nav>
  );
}
