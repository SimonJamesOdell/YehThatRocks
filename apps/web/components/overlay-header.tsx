import type { ReactNode } from "react";

import { CloseLink } from "@/components/close-link";

type OverlayHeaderProps = {
  className?: string;
  title?: ReactNode;
  breadcrumb?: ReactNode;
  icon?: ReactNode;
  headingClassName?: string;
  actions?: ReactNode;
  close?: boolean;
  closeSlot?: ReactNode;
  children?: ReactNode;
};

export function OverlayHeader({
  className,
  title,
  breadcrumb,
  icon,
  headingClassName,
  actions,
  close = true,
  closeSlot,
  children,
}: OverlayHeaderProps) {
  const resolvedClassName = ["favouritesBlindBar", className].filter(Boolean).join(" ");

  const resolvedHeaderContent = children ?? (
    <strong className={headingClassName}>
      {breadcrumb ? <span className="categoryHeaderBreadcrumb">{breadcrumb}</span> : null}
      {icon}
      {icon && title ? " " : null}
      {title}
    </strong>
  );

  return (
    <div className={resolvedClassName}>
      {resolvedHeaderContent}
      {actions}
      {closeSlot ?? (close ? <CloseLink /> : null)}
    </div>
  );
}
