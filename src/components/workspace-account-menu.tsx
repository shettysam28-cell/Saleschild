"use client";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ChevronDown, LogOut, Bell, Settings, SunMoon } from "lucide-react";
import { signOutAction } from "@/app/(auth)/actions";
import {
  readAppearance,
  saveAppearance,
  subscribeAppearance,
  serverAppearance,
  resolveAppearance,
} from "@/lib/workspace-appearance";

export function WorkspaceAccountMenu({
  displayName,
  organization,
  role,
}: {
  displayName: string;
  organization: string;
  role: string;
}) {
  const [open, setOpen] = useState(false);
  const appearance = useSyncExternalStore(subscribeAppearance, readAppearance, serverAppearance);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.workspaceTheme = resolveAppearance(
        appearance,
        media.matches,
      );
    };
    apply();
    media.addEventListener("change", apply);
    return () => {
      media.removeEventListener("change", apply);
    };
  }, [appearance]);
  useEffect(() => {
    if (!open) return;
    const pointer = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", pointer);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", pointer);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return (
    <div
      className="workspace-account"
      ref={container}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        className="workspace-account-trigger"
        aria-expanded={open}
        aria-controls={open ? "workspace-account-panel" : undefined}
        onClick={() => setOpen(!open)}
      >
        <span>
          <strong>{displayName || "Your account"}</strong>
          <small>
            {role === "learner" ? "Member" : role} · {organization}
          </small>
        </span>
        <ChevronDown size={17} aria-hidden="true" />
      </button>
      {open && (
        <div id="workspace-account-panel" className="workspace-account-panel">
          <fieldset className="workspace-appearance">
            <legend>
              <SunMoon size={16} aria-hidden="true" /> Appearance
            </legend>
            {(["light", "dark", "system"] as const).map((value) => (
              <label key={value}>
                <input
                  type="radio"
                  name="appearance"
                  value={value}
                  checked={appearance === value}
                  onChange={() => saveAppearance(value)}
                />
                {value[0].toUpperCase() + value.slice(1)}
              </label>
            ))}
          </fieldset>
          <Link href="/app/notifications" onClick={() => setOpen(false)}>
            <Bell size={16} aria-hidden="true" /> Notification Hub
          </Link>
          <Link href="/app/settings" onClick={() => setOpen(false)}>
            <Settings size={16} aria-hidden="true" /> Settings
          </Link>
          <form action={signOutAction}>
            <button>
              <LogOut size={16} aria-hidden="true" /> Log out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
