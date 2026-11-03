"use client";
import { createBrowserClient } from "@supabase/ssr";
import { supabaseConfig } from "@/lib/config";
export function createClient() {
  const config = supabaseConfig();
  if (!config) return null;
  return createBrowserClient(config.url, config.key);
}
