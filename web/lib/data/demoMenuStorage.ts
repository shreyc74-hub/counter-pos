import { toAdminMenu } from "@/lib/admin/menu";
import type { AdminMenu } from "@/lib/admin/types";
import { demoMenu } from "./demoMenu";

export const DEMO_MENU_KEY = "cpos.demo.menu.v2";

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
