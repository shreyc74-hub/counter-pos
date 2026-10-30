import { toAdminMenu } from "@/lib/admin/menu";
import type { AdminMenu } from "@/lib/admin/types";
import { demoMenu } from "./demoMenu";

export const DEMO_MENU_KEY = "cpos.demo.menu.v3";

/** The demo outlet's menu, including edits made in the demo admin panel. Shared by the demo counter and admin. */
export function loadDemoAdminMenu(s: Pick<Storage, "getItem"> | null): AdminMenu {
  try {
    const raw = s?.getItem(DEMO_MENU_KEY);
    if (raw) return JSON.parse(raw) as AdminMenu;
  } catch {
    // fall back to the built-in menu
  }
  return toAdminMenu(demoMenu);
}

export const DEMO_PHOTOS_KEY = "cpos.demo.photos.v1";

/** Demo dish photos ({itemId: data URL}), set in the demo admin panel and shown on the demo counter. */
export function loadDemoPhotos(s: Pick<Storage, "getItem"> | null): Record<string, string> {
  try {
    const v = JSON.parse(s?.getItem(DEMO_PHOTOS_KEY) ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}
