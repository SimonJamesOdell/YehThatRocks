export function openShareToSocialsModal(options: {
  setShareModalCopied: (value: boolean) => void;
  setShowShareModal: (value: boolean) => void;
  setShowShareMenu: (value: boolean) => void;
}) {
  options.setShareModalCopied(false);
  options.setShowShareModal(true);
  options.setShowShareMenu(false);
}

export function openShareTarget(targetUrl: string) {
  window.open(targetUrl, "_blank", "noopener,noreferrer");
}

export async function copyShareUrlForModal(options: {
  copyShareLink: () => Promise<void>;
  setShareModalCopied: (value: boolean) => void;
  resetDelayMs?: number;
}) {
  await options.copyShareLink();
  options.setShareModalCopied(true);

  window.setTimeout(() => {
    options.setShareModalCopied(false);
  }, options.resetDelayMs ?? 1600);
}
