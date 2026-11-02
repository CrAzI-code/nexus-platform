"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useState } from "react";

type TestResult = {
  status: number;
  body: unknown;
};

export default function ApiAuthTest() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const [isTesting, setIsTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function testApiAuthentication() {
    setResult(null);
    setError(null);

    if (!isLoaded) {
      setError("Clerk is still loading. Please try again in a moment.");
      return;
    }

    if (!isSignedIn) {
      setError("You are signed out. Sign in to NEXUS, then retry this test.");
      return;
    }

    setIsTesting(true);

    try {
      const token = await getToken();
      if (!token) {
        setError("Clerk did not return a session token. Try signing in again.");
        return;
      }

      const response = await fetch("http://localhost:4000/auth/me", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        setResult({ status: response.status, body: null });
        setError("The API response was not valid JSON.");
        return;
      }

      setResult({ status: response.status, body });
    } catch {
      setError(
        "The API request failed. Check that the API is running at localhost:4000 and allows requests from this development origin.",
      );
    } finally {
      setIsTesting(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-12 text-slate-900">
      <section className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-600">
          Temporary development-only tool
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">
          API authentication test
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Requests your signed-in Clerk session against{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5">
            GET http://localhost:4000/auth/me
          </code>
          . The session token is sent in the authorization header and is never
          shown or logged.
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!isLoaded || isTesting}
            onClick={testApiAuthentication}
            type="button"
          >
            {isTesting ? "Testing API…" : "Test API authentication"}
          </button>
          <span className="text-sm text-slate-500">
            {!isLoaded
              ? "Checking Clerk session…"
              : isSignedIn
                ? "Signed in"
                : "Signed out"}
          </span>
          {isLoaded && !isSignedIn && (
            <Link
              className="text-sm font-medium text-indigo-600 underline-offset-4 hover:underline"
              href="/sign-in"
            >
              Sign in
            </Link>
          )}
        </div>

        {error && (
          <p
            className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
            role="alert"
          >
            {error}
          </p>
        )}

        {result && (
          <section aria-label="API response" className="mt-6">
            <h2 className="text-sm font-semibold">
              HTTP status: {result.status}
            </h2>
            <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-950 p-4 text-sm leading-6 text-slate-100">
              {JSON.stringify(result.body, null, 2)}
            </pre>
          </section>
        )}
      </section>
    </main>
  );
}
