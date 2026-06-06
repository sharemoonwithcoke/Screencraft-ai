"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

interface Props {
  status: string;
  /** Polling interval in ms — default 4 s */
  intervalMs?: number;
}

/**
 * Invisible component: while `status` is "processing", it polls by calling
 * router.refresh() every `intervalMs` ms, which re-runs the server component
 * and reflects the latest status without a full page reload.
 */
export function StatusPoller({ status, intervalMs = 4000 }: Props) {
  const router = useRouter();

  useEffect(() => {
    if (status !== "processing") return;
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [status, intervalMs, router]);

  return null;
}
