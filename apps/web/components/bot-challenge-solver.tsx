"use client";

import { useEffect, useRef } from "react";

import { sha256Hex } from "@/lib/sha256";

const POW_SALT = "ytr-botok-v1:";
const DIFFICULTY_BITS = 18;
const SOLVED_AT_KEY = "ytr:botok:solved-at";
// Re-solve a little before the 7-day httpOnly cookie expires.
const SOLVE_TTL_MS = 6 * 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 2_000_000;

/**
 * Mirrors the server's meetsPowDifficulty check: the digest of
 * sha256("ytr-botok-v1:" + nonce) must have DIFFICULTY_BITS leading zero bits.
 * The first two bytes are "0000" in hex, and the high nibble of the third byte
 * must be 0-3 (its top two bits are zero).
 */
function meetsDifficulty(hexDigest: string): boolean {
  return hexDigest.startsWith("0000") && "0123".includes(hexDigest[4] ?? "f");
}

function solveNonce(): string {
  const prefix = Array.from(crypto.getRandomValues(new Uint8Array(12)))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  for (let counter = 0; counter < MAX_ATTEMPTS; counter += 1) {
    const nonce = `${prefix}${counter.toString(16)}`;
    if (meetsDifficulty(sha256Hex(POW_SALT + nonce))) {
      return nonce;
    }
  }

  return "";
}

/**
 * Silently solves the client-side proof-of-work once per ~week and posts it to
 * /api/bot-challenge, which sets the httpOnly `ytr_botok` cookie. That cookie
 * is then verified server-side by the human-trust gate for sensitive routes.
 *
 * This runs a few hundred milliseconds of hashing after first paint, then is
 * remembered in localStorage so it does not repeat on every navigation.
 */
export function BotChallengeSolver() {
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current || typeof window === "undefined") {
      return;
    }
    ranRef.current = true;

    try {
      const lastSolved = Number(window.localStorage.getItem(SOLVED_AT_KEY));
      if (Number.isFinite(lastSolved) && Date.now() - lastSolved < SOLVE_TTL_MS) {
        return;
      }
    } catch {
      // localStorage unavailable — solve anyway.
    }

    const timer = window.setTimeout(() => {
      const nonce = solveNonce();
      if (!nonce) {
        return;
      }

      void fetch("/api/bot-challenge", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nonce }),
      })
        .then((response) => {
          if (response.ok) {
            try {
              window.localStorage.setItem(SOLVED_AT_KEY, String(Date.now()));
            } catch {
              // ignore
            }
          }
        })
        .catch(() => {
          // Transient — will retry on a future page load.
        });
    }, 1500);

    return () => window.clearTimeout(timer);
  }, []);

  return null;
}
