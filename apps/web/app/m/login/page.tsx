"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useMobilePlayer } from "@/components/mobile/mobile-player-context";

export default function MobileLoginPage() {
  const router = useRouter();
  const { refreshAuth } = useMobilePlayer();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [screenName, setScreenName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (isLogin) {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim(), password }),
        });

        const data = await res.json();

        if (!res.ok || !data.ok) {
          setError(data.error || "Login failed");
          return;
        }

        await refreshAuth();
        router.push("/m");
      } else {
        if (!screenName.trim()) {
          setError("Screen name is required");
          setLoading(false);
          return;
        }

        const res = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: email.trim(),
            password,
            screenName: screenName.trim(),
          }),
        });

        const data = await res.json();

        if (!res.ok) {
          setError(typeof data.error === "string" ? data.error : "Registration failed");
          return;
        }

        await refreshAuth();
        router.push("/m");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="mobile-page-header">
        <h1 className="mobile-page-title">{isLogin ? "Login" : "Register"}</h1>
      </div>

      <form className="mobile-auth-form" onSubmit={handleSubmit}>
        {error && (
          <div className="mobile-auth-error">{error}</div>
        )}

        {!isLogin && (
          <div className="mobile-auth-field">
            <label className="mobile-auth-label" htmlFor="screenName">Screen Name</label>
            <input
              id="screenName"
              type="text"
              className="mobile-auth-input"
              value={screenName}
              onChange={(e) => setScreenName(e.target.value)}
              placeholder="Your public name"
              autoComplete="username"
            />
          </div>
        )}

        <div className="mobile-auth-field">
          <label className="mobile-auth-label" htmlFor="email">
            {isLogin ? "Email or Screen Name" : "Email"}
          </label>
          <input
            id="email"
            type={isLogin ? "text" : "email"}
            className="mobile-auth-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={isLogin ? "you@example.com" : "you@example.com"}
            autoComplete="email"
          />
        </div>

        <div className="mobile-auth-field">
          <label className="mobile-auth-label" htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            className="mobile-auth-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete={isLogin ? "current-password" : "new-password"}
          />
        </div>

        <button
          type="submit"
          className="mobile-auth-submit"
          disabled={loading}
        >
          {loading ? "Please wait..." : isLogin ? "Log In" : "Create Account"}
        </button>

        <p className="mobile-auth-link">
          {isLogin ? (
            <>
              Don&apos;t have an account?{" "}
              <button
                type="button"
                onClick={() => { setIsLogin(false); setError(null); }}
                style={{ background: "none", border: "none", color: "var(--mobile-accent)", cursor: "pointer", fontSize: "inherit", padding: 0, textDecoration: "underline" }}
              >
                Register
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => { setIsLogin(true); setError(null); }}
                style={{ background: "none", border: "none", color: "var(--mobile-accent)", cursor: "pointer", fontSize: "inherit", padding: 0, textDecoration: "underline" }}
              >
                Log in
              </button>
            </>
          )}
        </p>

        {isLogin && (
          <p className="mobile-auth-link">
            <Link href="/m/forgot-password">Forgot password?</Link>
          </p>
        )}
      </form>
    </div>
  );
}