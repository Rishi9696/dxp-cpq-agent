"use client";

import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type Mode = "loading" | "setup" | "verify" | "failed";

function MfaPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/";
  const [mode, setMode] = useState<Mode>("loading");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const bootstrap = useCallback(async () => {
    setMode("loading");
    setError(null);
    try {
      const res = await fetch("/api/auth/mfa/factors");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to check MFA status");

      if (data.enrolled) {
        // Already set up — session just needs to step up to AAL2.
        if (data.currentLevel === "aal2") {
          router.replace(next);
          return;
        }
        setFactorId(data.factorId);
        setMode("verify");
      } else {
        // First login: enroll a new authenticator.
        const enrollRes = await fetch("/api/auth/mfa/enroll", { method: "POST" });
        const enrollData = await enrollRes.json();
        if (!enrollRes.ok) throw new Error(enrollData?.error ?? "Failed to start MFA setup");
        setFactorId(enrollData.factorId);
        setQrCode(enrollData.qrCode);
        setSecret(enrollData.secret);
        setMode("setup");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setMode("failed");
    }
  }, [router, next]);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    if (mode === "setup" || mode === "verify") inputRef.current?.focus();
  }, [mode]);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId || verifying) return;
    setVerifying(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/mfa/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ factorId, code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Verification failed");
      router.push(next);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setCode("");
      setVerifying(false);
      inputRef.current?.focus();
    }
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="auth-brand-mark">
            <ShieldIcon />
          </span>
          <h1 className="auth-title">Two-factor authentication</h1>
          <p className="auth-subtitle">
            {mode === "setup"
              ? "Scan the QR code with Google Authenticator, then enter the 6-digit code."
              : "Enter the 6-digit code from your authenticator app."}
          </p>
        </div>

        <form className="auth-form" onSubmit={handleVerify}>
          {error && <div className="auth-error">{error}</div>}

          {mode === "loading" && <p className="mfa-loading">Checking your MFA status…</p>}

          {mode === "failed" && (
            <button type="button" className="auth-submit" onClick={bootstrap}>
              Try again
            </button>
          )}

          {mode === "setup" && qrCode && (
            <div className="mfa-qr-wrap">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrCode} alt="Scan this QR code with Google Authenticator" className="mfa-qr" />
              {secret && (
                <p className="mfa-secret">
                  Can&apos;t scan? Enter this key manually: <code>{secret}</code>
                </p>
              )}
            </div>
          )}

          {(mode === "setup" || mode === "verify") && (
            <>
              <div className="auth-field">
                <label htmlFor="mfa-code">Authentication code</label>
                <input
                  id="mfa-code"
                  ref={inputRef}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="123456"
                  className="mfa-code-input"
                  required
                  disabled={verifying}
                />
              </div>
              <button type="submit" className="auth-submit" disabled={verifying || code.length !== 6}>
                {verifying ? "Verifying…" : mode === "setup" ? "Activate & continue" : "Verify"}
              </button>
            </>
          )}
        </form>

        <p className="auth-hint">
          Wrong account?{" "}
          <button className="link-btn" onClick={signOut}>
            Sign out
          </button>
        </p>
      </div>
    </div>
  );
}

export default function MfaPage() {
  return (
    <Suspense>
      <MfaPageInner />
    </Suspense>
  );
}

function ShieldIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}
