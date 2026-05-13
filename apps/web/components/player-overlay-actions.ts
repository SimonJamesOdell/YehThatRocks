export function openAdminEditOverlay(options: {
  pauseActivePlayback: () => void;
  openAdminVideoEdit: () => void | Promise<void>;
}) {
  options.pauseActivePlayback();
  void options.openAdminVideoEdit();
}

export function openAdminDeleteConfirm(options: {
  setAdminEditError: (value: string | null) => void;
  setAdminEditStatus: (value: string | null) => void;
  setShowShareMenu: (value: boolean) => void;
  setShowAdminDeleteConfirmModal: (value: boolean) => void;
}) {
  options.setAdminEditError(null);
  options.setAdminEditStatus(null);
  options.setShowShareMenu(false);
  options.setShowAdminDeleteConfirmModal(true);
}

export function toggleShareMenu(options: {
  setShowShareMenu: (updater: (previous: boolean) => boolean) => void;
}) {
  options.setShowShareMenu((previous) => !previous);
}
