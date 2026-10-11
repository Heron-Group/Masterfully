"use server";

import { requireSession } from "@/lib/auth";
import { updateMapLayout, type MapView } from "@/lib/map/layout";

// The map's own layout data (users/<id>/map-layout.json). Nothing here
// touches sources, links or groups: the map is read-only apart from this.

export type ActionResult = { ok: true } | { ok: false; error: string };

type Position = { x: number; y: number };

const VIEWS: MapView[] = ["network", "groups"];
const NODE_ID = /^[sg]:[^\s]{1,200}$/;
const MAX_PINS = 5000;

const isView = (v: unknown): v is MapView => VIEWS.includes(v as MapView);
const isPosition = (p: unknown): p is Position =>
  !!p &&
  typeof p === "object" &&
  [(p as Position).x, (p as Position).y].every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 1e6);

async function save(change: Parameters<typeof updateMapLayout>[1]): Promise<ActionResult> {
  const account = await requireSession();
  try {
    await updateMapLayout(account.id, change);
    return { ok: true };
  } catch (err) {
    console.error(err);
    return { ok: false, error: "Couldn't save the map layout." };
  }
}

/** Remember which view the map was last on. */
export async function saveMapView(view: MapView): Promise<ActionResult> {
  if (!isView(view)) return { ok: false, error: "Unknown view." };
  return save((layout) => {
    layout.lastView = view;
  });
}

/** Pin nodes where they were dragged to, in one view. */
export async function pinMapNodes(view: MapView, positions: Record<string, Position>): Promise<ActionResult> {
  if (!isView(view) || !positions || typeof positions !== "object") return { ok: false, error: "Invalid layout." };
  const entries = Object.entries(positions);
  if (!entries.length || entries.length > MAX_PINS || !entries.every(([id, p]) => NODE_ID.test(id) && isPosition(p))) {
    return { ok: false, error: "Invalid layout." };
  }
  return save((layout) => {
    const pins = (layout.pins ??= {});
    const forView = { ...(pins[view] ?? {}) };
    for (const [id, p] of entries) forView[id] = { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 };
    if (Object.keys(forView).length > MAX_PINS) return;
    pins[view] = forView;
  });
}

/** Forget the pinned positions for one view. */
export async function resetMapLayout(view: MapView): Promise<ActionResult> {
  if (!isView(view)) return { ok: false, error: "Unknown view." };
  return save((layout) => {
    if (layout.pins) delete layout.pins[view];
  });
}
