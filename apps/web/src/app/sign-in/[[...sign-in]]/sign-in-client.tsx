"use client";

import { SignIn } from "@clerk/nextjs";
import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const getSnapshot = () => true;
const getServerSnapshot = () => false;

export function SignInClient() {
  const isMounted = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  return isMounted ? (
    <SignIn />
  ) : (
    <div aria-live="polite" className="auth-loading" role="status">
      Loading sign-in…
    </div>
  );
}