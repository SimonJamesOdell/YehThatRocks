"use client";

import type { ReactNode } from "react";

type ServiceFailurePanelProps = {
  mainAriaLabel: string;
  panelAriaLabel: string;
  eyebrow: string;
  title: string;
  lead: ReactNode;
  actions?: ReactNode;
  headingLevel?: 1 | 2;
  prePanelContent?: ReactNode;
};

export function ServiceFailurePanel({
  mainAriaLabel,
  panelAriaLabel,
  eyebrow,
  title,
  lead,
  actions,
  headingLevel = 2,
  prePanelContent,
}: ServiceFailurePanelProps) {
  const HeadingTag = headingLevel === 1 ? "h1" : "h2";

  return (
    <main className="serviceFailureScreen" role="main" aria-label={mainAriaLabel}>
      {prePanelContent}
      <div className="serviceFailureBackdrop" aria-hidden="true" />
      <section className="serviceFailurePanel" role="status" aria-live="polite" aria-label={panelAriaLabel}>
        <p className="serviceFailureEyebrow">{eyebrow}</p>
        <HeadingTag className="serviceFailureTitle">{title}</HeadingTag>
        <p className="serviceFailureLead">{lead}</p>
        {actions ? <div className="serviceFailureActions">{actions}</div> : null}
      </section>
    </main>
  );
}