"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

interface Props {
  hasProcessing: boolean;
  intervalMs?: number;
}

/**
 * Invisible component: polls via router.refresh() while any recording is still
 * being analysed, so the dashboard reflects status changes without a manual reload.
 */
export function DashboardPoller({ hasProcessing, intervalMs = 5000 }: Props) {
  const router = useRouter();

  useEffect(() => {
    if (!hasProcessing) return;
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [hasProcessing, intervalMs, router]);

  return null;
}
