"use client";

import { useState } from "react";

type AnonymousCredentialsModalProps = {
  username: string;
  password: string;
  canBrowserSaveCredentials: boolean;
  isContinuing: boolean;
  onClose: () => void;
  onContinue: () => void | Promise<void>;
};

const BROWSER_SAVE_ATTEMPT_NOTE = "When you click Continue, your browser will try to save these credentials for you.";
const MANUAL_SAVE_REQUIRED_NOTE = "Your browser cannot save these credentials automatically here, so manual saving is required before you continue.";

export function AnonymousCredentialsModal({
  username,
  password,
  canBrowserSaveCredentials,
  isContinuing,
  onClose,
  onContinue,
}: AnonymousCredentialsModalProps) {
  const [copied, setCopied] = useState<"username" | "password" | null>(null);

  const copyToClipboard = (text: string, type: "username" | "password") => {
    navigator.clipboard.writeText(text);
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="modalOverlay" onClick={() => {
      if (!isContinuing) {
        onClose();
      }
    }}>
      <div className="modalContent" onClick={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <h2>Your Anonymous Account Credentials</h2>
          <button className="modalCloseButton" onClick={onClose} disabled={isContinuing}>×</button>
        </div>

        <div className="modalBody">
          <div className="modalBodyGrid">
            <div className="modalColumn modalColumnPrimary">
              <div className="credentialsSection">
                <h3>Login Details</h3>
                <p className="credentialsSaveTiny">Save these credentials now.</p>
                <div className="credentialField">
                  <label>Username:</label>
                  <div className="credentialDisplay">
                    <code>{username}</code>
                    <button
                      className="copyButton"
                      onClick={() => copyToClipboard(username, "username")}
                      title="Copy username"
                    >
                      {copied === "username" ? "✓ Copied" : "Copy"}
                    </button>
                  </div>
                </div>

                <div className="credentialField">
                  <label>Password:</label>
                  <div className="credentialDisplay">
                    <code>{password}</code>
                    <button
                      className="copyButton"
                      onClick={() => copyToClipboard(password, "password")}
                      title="Copy password"
                    >
                      {copied === "password" ? "✓ Copied" : "Copy"}
                    </button>
                  </div>
                </div>

                {!canBrowserSaveCredentials ? (
                  <p className="credentialsSaveNotice" role="status" aria-live="polite">
                    {MANUAL_SAVE_REQUIRED_NOTE}
                  </p>
                ) : null}
                <span className="srOnly" aria-hidden="true">{BROWSER_SAVE_ATTEMPT_NOTE}</span>
              </div>
            </div>

            <div className="modalColumn modalColumnSecondary">
              <div className="credentialsBenefits">
                <h3>You can always upgrade to a regular account</h3>
                <p>
                  At any time, you can upgrade your anonymous account to a regular account by providing a working email address. This will enable account recovery and additional features.
                </p>
                <p>
                  To add your email address, simply visit the account section
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="modalFooter">
          <button className="secondaryButton" onClick={onClose} disabled={isContinuing}>
            Cancel
          </button>
          <button className="primaryButton" onClick={onContinue} disabled={isContinuing}>
            {isContinuing ? "Continuing..." : "Continue"}
          </button>
        </div>
      </div>

      <style jsx>{`
        .modalOverlay {
          position: fixed;
          inset: 0;
          background: rgba(8, 9, 11, 0.9);
          backdrop-filter: blur(6px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10000;
          padding: 24px;
          overflow-y: auto;
        }

        .modalContent {
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 22px;
          max-width: 980px;
          width: min(100%, 700px);
          max-height: calc(100vh - 48px);
          overflow-y: auto;
          background:
            radial-gradient(circle at top left, rgba(255, 255, 255, 0.08), transparent 36%),
            linear-gradient(180deg, rgba(21, 23, 27, 0.98), rgba(12, 14, 18, 0.98)),
            rgba(13, 15, 19, 0.98);
          box-shadow: 0 32px 80px rgba(0, 0, 0, 0.45);
          color: var(--text-primary, #fff);
        }

        .modalHeader {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 20px;
          border-bottom: 1px solid var(--border-color, #333);
        }

        .modalHeader h2 {
          margin: 0;
          font-size: 20px;
          font-weight: 600;
        }

        .modalCloseButton {
          background: none;
          border: none;
          color: var(--text-secondary, #ccc);
          font-size: 28px;
          cursor: pointer;
          padding: 0;
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .modalCloseButton:hover {
          color: var(--text-primary, #fff);
        }

        .modalBody {
          padding: 20px;
        }

        .modalBodyGrid {
          display: grid;
          grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
          gap: 16px;
          align-items: stretch;
        }

        .modalColumn {
          display: flex;
          flex-direction: column;
          gap: 16px;
          min-width: 0;
          height: 100%;
        }

        .credentialsWarning {
          display: flex;
          gap: 12px;
          padding: 16px;
          background: rgba(255, 193, 7, 0.1);
          border: 1px solid rgba(255, 193, 7, 0.3);
          border-radius: 6px;
          margin-bottom: 20px;
        }

        .warningIcon {
          flex-shrink: 0;
          font-size: 24px;
        }

        .warningText {
          flex-grow: 1;
          font-size: 14px;
          line-height: 1.5;
        }

        .warningText strong {
          color: #ffc107;
        }

        .credentialsSection {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid var(--border-color, #333);
          border-radius: 6px;
          padding: 16px;
          height: 100%;
          display: flex;
          flex-direction: column;
        }

        .credentialsSection h3 {
          margin: 0 0 12px 0;
          font-size: 15px;
          color: var(--text-primary, #fff);
        }

        .credentialsSaveTiny {
          margin: -4px 0 12px;
          font-size: 11px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: rgba(255, 220, 205, 0.78);
        }

        .credentialsSaveNotice {
          margin: 14px 0 0;
          padding: 10px 12px;
          border-radius: 6px;
          border: 1px solid rgba(74, 158, 255, 0.35);
          background: rgba(74, 158, 255, 0.12);
          color: var(--text-primary, #fff);
          font-size: 12px;
          line-height: 1.45;
        }

        .credentialField {
          margin-bottom: 16px;
        }

        .credentialField:last-child {
          margin-bottom: 0;
        }

        .credentialField label {
          display: block;
          font-size: 14px;
          font-weight: 500;
          margin-bottom: 8px;
          color: var(--text-secondary, #ccc);
        }

        .credentialDisplay {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .credentialDisplay code {
          flex-grow: 1;
          background: rgba(0, 0, 0, 0.3);
          padding: 12px;
          border-radius: 4px;
          font-family: "Courier New", monospace;
          font-size: 13px;
          word-break: break-all;
          border: 1px solid var(--border-color, #333);
        }

        .copyButton {
          background: var(--accent-color, #4a9eff);
          color: white;
          border: none;
          padding: 8px 16px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
          font-weight: 500;
          white-space: nowrap;
          transition: background 0.2s;
        }

        .copyButton:hover {
          background: var(--accent-color-hover, #3a8ee0);
        }

        .credentialsBenefits {
          background: rgba(76, 175, 80, 0.1);
          border: 1px solid rgba(76, 175, 80, 0.3);
          border-radius: 6px;
          padding: 16px;
          height: 100%;
          display: flex;
          flex-direction: column;
        }

        .credentialsBenefits h3 {
          margin: 0 0 12px 0;
          font-size: 15px;
          color: #4caf50;
        }

        .credentialsBenefits p {
          margin: 0 0 12px 0;
          font-size: 13px;
          line-height: 1.5;
          color: var(--text-primary, #fff);
        }

        .benefitsList {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .benefitItem {
          font-size: 13px;
          color: var(--text-secondary, #ccc);
        }

        .privacyGuarantee {
          background: rgba(33, 150, 243, 0.1);
          border: 1px solid rgba(33, 150, 243, 0.3);
          border-radius: 6px;
          padding: 12px;
          font-size: 12px;
          line-height: 1.5;
          color: var(--text-primary, #fff);
        }

        .privacyGuarantee strong {
          color: #2196f3;
        }

        .modalFooter {
          display: flex;
          gap: 12px;
          padding: 16px 20px;
          border-top: 1px solid var(--border-color, #333);
          background: rgba(0, 0, 0, 0.2);
        }

        .primaryButton,
        .secondaryButton {
          flex: 1;
          padding: 12px 20px;
          border: none;
          border-radius: 4px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: background 0.2s;
        }

        .primaryButton {
          background: var(--accent-color, #4a9eff);
          color: white;
        }

        .primaryButton:hover {
          background: var(--accent-color-hover, #3a8ee0);
        }

        .primaryButton:disabled,
        .secondaryButton:disabled,
        .modalCloseButton:disabled {
          opacity: 0.7;
          cursor: not-allowed;
        }

        .secondaryButton {
          background: rgba(255, 255, 255, 0.1);
          color: var(--text-primary, #fff);
          border: 1px solid var(--border-color, #333);
        }

        .secondaryButton:hover {
          background: rgba(255, 255, 255, 0.15);
        }

        @media (max-width: 900px) {
          .modalOverlay {
            padding: 16px;
          }

          .modalContent {
            width: 100%;
            max-height: calc(100vh - 32px);
          }

          .modalBodyGrid {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 640px) {
          .modalOverlay {
            align-items: end;
            padding: 16px;
          }

          .modalContent {
            border-radius: 20px 20px 0 0;
            max-height: calc(100vh - 16px);
          }

          .modalHeader h2 {
            font-size: 18px;
          }

          .modalFooter {
            flex-direction: column;
          }
        }
      `}</style>
    </div>
  );
}
