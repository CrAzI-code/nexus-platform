import Link from "next/link";
import { Suspense } from "react";
import { SignInClient } from "./sign-in-client";

export default function SignInPage() {
  return (
    <main className="auth-page">
      <section aria-labelledby="auth-title" className="auth-card">
        <Link aria-label="NEXUS" className="auth-brand" href="/">
          <span aria-hidden="true" className="auth-brand-mark">N</span>
          <span>NEXUS</span>
        </Link>
        <div className="auth-heading">
          <p className="auth-eyebrow">YOUR WORKSPACE, IN SYNC</p>
          <h1 id="auth-title">Welcome back</h1>
          <p>Sign in to pick up where your team left off.</p>
        </div>
        <div className="auth-form">
          <Suspense fallback={<div className="auth-loading">Loading sign-in…</div>}>
            <SignInClient />
          </Suspense>
        </div>
      </section>
    </main>
  );
}
