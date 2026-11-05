export type Appearance = "light" | "dark" | "system";
export const appearanceKey = "saleschild.workspace.appearance";
export function isAppearance(value: unknown): value is Appearance {
  return value === "light" || value === "dark" || value === "system";
}
export function resolveAppearance(appearance: Appearance, systemDark: boolean) {
  return appearance === "system" ? (systemDark ? "dark" : "light") : appearance;
}
let sessionAppearance: Appearance = "system";
export function readAppearance(): Appearance {
  try {
    const stored = localStorage.getItem(appearanceKey);
    return isAppearance(stored) ? stored : "system";
  } catch {
    return sessionAppearance;
  }
}
export function saveAppearance(value: Appearance) {
  sessionAppearance = value;
  try {
    localStorage.setItem(appearanceKey, value);
  } catch {
    /* A session preference still works. */
  }
  window.dispatchEvent(new Event("workspace-appearance"));
}
export function subscribeAppearance(onChange: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === appearanceKey) onChange();
  };
  window.addEventListener("storage", storage);
  window.addEventListener("workspace-appearance", onChange);
  return () => {
    window.removeEventListener("storage", storage);
    window.removeEventListener("workspace-appearance", onChange);
  };
}
export function serverAppearance(): Appearance {
  return "system";
}
// This runs before the workspace is painted; it contains no account data or network calls.
export const workspaceAppearanceScript = `(()=>{try{const p=localStorage.getItem('${appearanceKey}');const a=p==='light'||p==='dark'?p:'system';document.documentElement.dataset.workspaceTheme=a==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):a}catch{document.documentElement.dataset.workspaceTheme=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}})()`;
