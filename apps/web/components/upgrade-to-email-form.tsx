"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type UpgradeToEmailFormProps = {
  onSuccess?: () => void;
  onCancel?: () => void;
};

export function UpgradeToEmailForm({ onSuccess, onCancel }: UpgradeToEmailFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);

    startTransition(async () => {
      try {
        const response = await fetch("/api/auth/upgrade-to-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });

        if (!response.ok) {
          const data = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(data?.error || "Failed to upgrade account");
        }

        setMessage("Account upgraded successfully! Check your email to verify your address.");
        setEmail("");
        setTimeout(() => {
          router.refresh();
          onSuccess?.();
        }, 2000);
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred");
      }
    });
  };

  return (
    <div className="upgradeToEmailForm">
      <div className="formContainer">
        <h2>Upgrade to Email Account</h2>
        <p className="formDescription">
          Provide your email address to upgrade your account and enable account recovery.
        </p>

        <form onSubmit={handleSubmit}>
          <div className="formGroup">
            <label htmlFor="email">Email Address</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
              disabled={isPending}
            />
          </div>

          <div className="privacyNotice">
            We guarantee we will never send spam or misuse your email. It&apos;s purely for account
            retrieval and recovery purposes.
          </div>

          {error && <div className="errorMessage">{error}</div>}
          {message && <div className="successMessage">{message}</div>}

          <div className="formActions">
            <button type="button" className="secondaryButton" onClick={onCancel} disabled={isPending}>
              Cancel
            </button>
            <button type="submit" className="primaryButton" disabled={isPending || !email.trim()}>
              {isPending ? "Upgrading..." : "Upgrade Account"}
            </button>
          </div>
        </form>
      </div>

      <style jsx>{`
        .upgradeToEmailForm {
          padding: 20px;
        }

        .formContainer {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid var(--border-color, #333);
          border-radius: 8px;
          padding: 24px;
          max-width: 400px;
          margin: 0 auto;
        }

        .formContainer h2 {
          margin: 0 0 12px 0;
          font-size: 20px;
          font-weight: 600;
          color: var(--text-primary, #fff);
        }

        .formDescription {
          margin: 0 0 20px 0;
          font-size: 14px;
          color: var(--text-secondary, #ccc);
          line-height: 1.5;
        }

        .formGroup {
          margin-bottom: 16px;
        }

        .formGroup label {
          display: block;
          font-size: 14px;
          font-weight: 500;
          margin-bottom: 8px;
          color: var(--text-secondary, #ccc);
        }

        .formGroup input {
          width: 100%;
          padding: 12px;
          background: rgba(0, 0, 0, 0.3);
          border: 1px solid var(--border-color, #333);
          border-radius: 4px;
          color: var(--text-primary, #fff);
          font-size: 14px;
          font-family: inherit;
          transition: border-color 0.2s;
        }

        .formGroup input:focus {
          outline: none;
          border-color: var(--accent-color, #4a9eff);
          background: rgba(0, 0, 0, 0.5);
        }

        .formGroup input:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .privacyNotice {
          background: rgba(33, 150, 243, 0.1);
          border: 1px solid rgba(33, 150, 243, 0.3);
          border-radius: 4px;
          padding: 12px;
          font-size: 12px;
          line-height: 1.5;
          color: var(--text-primary, #fff);
          margin-bottom: 16px;
        }

        .errorMessage {
          background: rgba(255, 107, 107, 0.1);
          border: 1px solid rgba(255, 107, 107, 0.3);
          color: #ff6b6b;
          padding: 12px;
          border-radius: 4px;
          font-size: 13px;
          margin-bottom: 16px;
        }

        .successMessage {
          background: rgba(76, 175, 80, 0.1);
          border: 1px solid rgba(76, 175, 80, 0.3);
          color: #4caf50;
          padding: 12px;
          border-radius: 4px;
          font-size: 13px;
          margin-bottom: 16px;
        }

        .formActions {
          display: flex;
          gap: 12px;
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
          transition: opacity 0.2s;
        }

        .primaryButton {
          background: var(--accent-color, #4a9eff);
          color: white;
        }

        .primaryButton:hover:not(:disabled) {
          opacity: 0.9;
        }

        .primaryButton:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .secondaryButton {
          background: rgba(255, 255, 255, 0.1);
          color: var(--text-primary, #fff);
          border: 1px solid var(--border-color, #333);
        }

        .secondaryButton:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.15);
        }

        .secondaryButton:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}
