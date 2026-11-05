"use client";
import { useEffect } from "react";
import { recordPresence } from "@/app/app/member-actions";

// Account presence is approximate and independent of all learning progress.
export function WorkspacePresence() {
  useEffect(() => {
    let lastSent = 0;
    const record = () => {
      const now = Date.now();
      if (document.visibilityState !== "visible" || now - lastSent < 120000) return;
      lastSent = now;
      void recordPresence().catch(() => {
        /* Presence never interrupts the workspace. */
      });
    };
    const visibility = () => {
      if (document.visibilityState === "visible") record();
    };
    record();
    window.addEventListener("pointerdown", record, { passive: true });
    window.addEventListener("keydown", record);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("pointerdown", record);
      window.removeEventListener("keydown", record);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  return null;
}
