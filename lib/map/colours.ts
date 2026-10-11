// Reading-group colours for the Source Map and the group page's colour
// picker. Distinct mid-tone hues that read on both the light and dark
// themes; colour is never the only cue (groups are always named too).
// Grey is kept for sources in no group.

export const GROUP_PALETTE = [
  { name: "Blue", hex: "#4e79a7" },
  { name: "Orange", hex: "#f28e2b" },
  { name: "Green", hex: "#59a14f" },
  { name: "Purple", hex: "#9467bd" },
  { name: "Teal", hex: "#2a9d8f" },
  { name: "Gold", hex: "#d4a72c" },
  { name: "Red", hex: "#e15759" },
  { name: "Brown", hex: "#9c755f" },
  { name: "Pink", hex: "#e377c2" },
  { name: "Sky", hex: "#4fa3d1" },
] as const;

export const UNGROUPED_COLOUR = "#9a968e";

export const isPaletteColour = (hex: string) => GROUP_PALETTE.some((c) => c.hex === hex);

export function colourName(hex: string): string {
  return GROUP_PALETTE.find((c) => c.hex === hex)?.name ?? hex;
}

/**
 * A colour for every group: saved choices are kept; new groups take the
 * least-used palette colour (oldest group first), so colours don't shift
 * when groups are added. Returns the full set and whether anything new was
 * assigned (so it can be saved).
 */
export function assignColours(
  groups: Array<{ id: string; created: string }>,
  saved: Record<string, string>,
): { colours: Record<string, string>; changed: boolean } {
  const colours: Record<string, string> = {};
  const uses = new Map<string, number>(GROUP_PALETTE.map((c) => [c.hex, 0]));
  for (const g of groups) {
    const hex = saved[g.id];
    if (hex && isPaletteColour(hex)) {
      colours[g.id] = hex;
      uses.set(hex, (uses.get(hex) ?? 0) + 1);
    }
  }
  let changed = false;
  const ordered = [...groups].sort((a, b) => a.created.localeCompare(b.created) || a.id.localeCompare(b.id));
  for (const g of ordered) {
    if (colours[g.id]) continue;
    // Least used, then palette order.
    const pick = GROUP_PALETTE.reduce((best, c) => ((uses.get(c.hex) ?? 0) < (uses.get(best.hex) ?? 0) ? c : best), GROUP_PALETTE[0]);
    colours[g.id] = pick.hex;
    uses.set(pick.hex, (uses.get(pick.hex) ?? 0) + 1);
    changed = true;
  }
  return { colours, changed };
}
