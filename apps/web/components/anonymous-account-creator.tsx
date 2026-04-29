"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AnonymousCredentialsModal } from "@/components/anonymous-credentials-modal";

type AnonymousAccountCreatorProps = {
  onSuccess?: () => void;
};

export function AnonymousAccountCreator({ onSuccess }: AnonymousAccountCreatorProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [isContinuing, setIsContinuing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<{
    username: string;
    password: string;
  } | null>(null);

  const handleCreateAnonymousAccount = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/anonymous", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || "Failed to create anonymous account");
      }

      const data = (await response.json().catch(() => null)) as {
        credentials?: { username: string; password: string };
      } | null;

      if (data?.credentials) {
        setCredentials(data.credentials);
        setIsLoading(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
      setIsLoading(false);
    }
  };

  const handleModalClose = () => {
    setCredentials(null);
  };

  const handleModalContinue = async () => {
    setIsContinuing(true);
    setCredentials(null);
    try {
      router.refresh();
      onSuccess?.();
    } finally {
      setIsContinuing(false);
      setIsLoading(false);
    }
  };

  const canBrowserSaveCredentials = typeof window !== "undefined" && "credentials" in navigator;

  if (credentials) {
    return (
      <AnonymousCredentialsModal
        username={credentials.username}
        password={credentials.password}
        canBrowserSaveCredentials={canBrowserSaveCredentials}
        isContinuing={isContinuing}
        onClose={handleModalClose}
        onContinue={handleModalContinue}
      />
    );
  }

  return (
    <div className="anonymousAccountCreator">
      <button
        className="anonymousAccountButton"
        onClick={handleCreateAnonymousAccount}
        disabled={isLoading}
      >
        {isLoading ? "Creating..." : "Continue as Anonymous"}
      </button>
      {error && <div className="errorMessage">{error}</div>}

      <style jsx>{`
        .anonymousAccountCreator {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .anonymousAccountButton {
          padding: 12px 24px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          border: none;
          border-radius: 6px;
          font-size: 16px;
          font-weight: 500;
          cursor: pointer;
          transition: opacity 0.2s;
        }

        .anonymousAccountButton:hover:not(:disabled) {
          opacity: 0.9;
        }

        .anonymousAccountButton:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .errorMessage {
          color: #ff6b6b;
          font-size: 14px;
          padding: 8px;
          background: rgba(255, 107, 107, 0.1);
          border-radius: 4px;
          border: 1px solid rgba(255, 107, 107, 0.3);
        }
      `}</style>
    </div>
  );
}
