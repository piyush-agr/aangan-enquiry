"use client";
import { useState } from "react";

export function LoginForm() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const f = new FormData(e.currentTarget);
        const res = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: f.get("email"), password: f.get("password") }) });
        setBusy(false);
        if (res.ok) window.location.href = "/";
        else setError((await res.json().catch(() => ({}))).error ?? "Sign-in failed.");
      }}
    >
      {error ? <div className="alert err" role="alert">{error}</div> : null}
      <label className="f">Email<input name="email" type="email" autoComplete="username" required /></label>
      <label className="f">Password<input name="password" type="password" autoComplete="current-password" required /></label>
      <button className="btn" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}
