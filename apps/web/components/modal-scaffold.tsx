import { ReactNode } from "react";
import { createPortal } from "react-dom";

interface ModalScaffoldProps {
  isOpen: boolean;
  onClose: () => void;
  ariaLabel: string;
  backdropClassName?: string;
  panelClassName?: string;
  children: ReactNode;
  disabled?: boolean;
}

export function ModalScaffold({
  isOpen,
  onClose,
  ariaLabel,
  backdropClassName = "modalBackdrop",
  panelClassName = "modalPanel",
  children,
  disabled = false,
}: ModalScaffoldProps) {
  if (!isOpen || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className={backdropClassName}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      onClick={() => {
        if (!disabled) {
          onClose();
        }
      }}
    >
      <div className={panelClassName} onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>,
    document.body
  );
}
