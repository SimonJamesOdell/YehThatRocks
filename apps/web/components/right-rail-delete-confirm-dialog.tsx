"use client";

type RightRailDeleteConfirmDialogProps = {
  targetName: string;
  isBusy: boolean;
  busyLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
};

export function RightRailDeleteConfirmDialog({
  targetName,
  isBusy,
  busyLabel = "Deleting...",
  onCancel,
  onConfirm,
}: RightRailDeleteConfirmDialogProps) {
  return (
    <div
      className="rightRailDeleteConfirmBackdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Delete playlist confirmation"
      onClick={onCancel}
    >
      <div
        className="rightRailDeleteConfirmModal"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <div className="rightRailDeleteConfirmHeader">
          <span className="rightRailDeleteConfirmIcon" aria-hidden="true">⚠</span>
          <h3>Delete Playlist?</h3>
        </div>
        <p className="rightRailDeleteConfirmPrompt">This action is permanent and cannot be undone.</p>
        <p className="rightRailDeleteConfirmTarget">{targetName}</p>
        <div className="rightRailDeleteConfirmActions">
          <button
            type="button"
            onClick={onCancel}
            disabled={isBusy}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isBusy}
          >
            {isBusy ? busyLabel : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
