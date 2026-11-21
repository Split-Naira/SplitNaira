/* eslint-disable jsx-a11y/no-noninteractive-element-interactions */
import { useEffect, useRef } from "react";
import "./Modal.css";
import { useFocusTrap } from "./useFocusTrap";
import {
  registerModal,
  restoreFocusAfterClose,
  type ModalFocusEntry,
} from "./modalFocus";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  closeOnOverlayClick?: boolean;
};

export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  closeOnOverlayClick = true,
}: Props) {
  const modalRef = useRef<HTMLDivElement>(null);

  // Save the trigger before the trap moves focus into the dialog, then
  // restore it on close or unmount. Nested dialogs are tracked in a stack so a
  // child whose trigger disappeared returns focus to its parent instead of
  // dropping it on <body> (#1592).
  useEffect(() => {
    if (!isOpen) return;

    const entry: ModalFocusEntry = {
      trigger: document.activeElement as HTMLElement | null,
      dialog: modalRef.current,
    };
    registerModal(entry);

    // Passive cleanup runs after the dialog has left the DOM, so `isConnected`
    // reliably tells us whether the trigger survived the close.
    return () => restoreFocusAfterClose(entry);
  }, [isOpen]);

  useFocusTrap(modalRef, isOpen);

  // Escape key handler
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
    }

    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay"
      onClick={closeOnOverlayClick ? onClose : undefined}
      onKeyDown={closeOnOverlayClick ? (e) => e.key === 'Enter' && onClose() : undefined}
      role="button"
      tabIndex={0}
    >
      <div
        className="modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Enter' && e.stopPropagation()}
        tabIndex={-1}
      >
        {title && <h2 id="modal-title">{title}</h2>}

        <div className="modal-body">{children}</div>

        <button className="modal-close" onClick={onClose} tabIndex={-1}>
          Close
        </button>
      </div>
    </div>
  );
}
