import { SignUp } from "@clerk/nextjs";
import Link from "next/link";
import { Suspense } from "react";

export default function SignUpPage() {
  return (
    <main className="auth-page">
      <section aria-labelledby="auth-title" className="auth-card">
        <Link aria-label="NEXUS" className="auth-brand" href="/">
          <span aria-hidden="true" className="auth-brand-mark">N</span>
          <span>NEXUS</span>
        </Link>
        <div className="auth-heading">
          <p className="auth-eyebrow">YOUR WORKSPACE, IN SYNC</p>
          <h1 id="auth-title">Create your account</h1>
          <p>Bring your team&apos;s projects and priorities together.</p>
        </div>
        <div className="auth-form">
          <Suspense fallback={<div className="auth-loading">Loading sign-up…</div>}>
            <SignUp />
          </Suspense>
        </div>
      </section>
    </main>
  );
}
