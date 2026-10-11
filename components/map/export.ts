import type { Core, EdgeSingular, NodeSingular } from "cytoscape";
import type { ThemeTokens } from "./elements";

// Saving the map as it's shown (current view, filters and zoom) as SVG or
// PNG, with a legend and the date underneath, for supervision meetings and
// the thesis. The SVG is written directly from the map's positions and
// styles: real shapes and one <text> per label, in named layers, so it
// opens in Illustrator with editable text.

export type LegendEntry = { colour: string; label: string };
export type ExportInfo = { title: string; subtitle: string; legend: LegendEntry[]; theme: ThemeTokens };

type LegendItem =
  | { type: "text"; x: number; y: number; text: string; size: number; weight: number; colour: string }
  | { type: "dot"; x: number; y: number; r: number; colour: string };

const PAD = 24;
const COL = 220;
const ROW = 20;

function legendLayout(width: number, info: ExportInfo): { height: number; items: LegendItem[] } {
  const items: LegendItem[] = [
    { type: "text", x: PAD, y: PAD + 14, text: info.title, size: 16, weight: 600, colour: info.theme.ink },
    { type: "text", x: PAD, y: PAD + 34, text: info.subtitle, size: 12, weight: 400, colour: info.theme.muted },
  ];
  const cols = Math.max(1, Math.floor((width - PAD * 2) / COL));
  const top = PAD + 62;
  info.legend.forEach((entry, i) => {
    const x = PAD + (i % cols) * COL;
    const y = top + Math.floor(i / cols) * ROW;
    items.push({ type: "dot", x: x + 5, y: y - 4, r: 5, colour: entry.colour });
    const text = entry.label.length > 32 ? `${entry.label.slice(0, 31)}…` : entry.label;
    items.push({ type: "text", x: x + 16, y, text, size: 12, weight: 400, colour: info.theme.ink });
  });
  const rows = Math.ceil(info.legend.length / cols);
  return { height: top + rows * ROW + PAD - 8, items };
}

/** The first font family, unquoted, for files opened outside the browser. */
function fontFamily(css: string): string {
  const first = css.split(",")[0]?.trim().replace(/^["']|["']$/g, "") ?? "";
  const name = !first || first.startsWith("__") ? "Inter" : first;
  return `${name}, Helvetica, Arial, sans-serif`;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const n = (v: number) => (Math.round(v * 100) / 100).toString();
const px = (v: unknown) => parseFloat(String(v)) || 0;

function edgePath(e: EdgeSingular): { d: string; tip: { x: number; y: number }; from: { x: number; y: number } } {
  const s = e.renderedSourceEndpoint();
  const t = e.renderedTargetEndpoint();
  // (renderedControlPoints() throws for a straight edge; controlPoints() returns undefined.)
  const zoom = e.cy().zoom();
  const pan = e.cy().pan();
  const cps = (e.data("kind") === "link" ? (e.controlPoints() ?? []) : []).map((p) => ({ x: p.x * zoom + pan.x, y: p.y * zoom + pan.y }));
  let d = `M${n(s.x)} ${n(s.y)}`;
  if (!cps.length) return { d: `${d} L${n(t.x)} ${n(t.y)}`, tip: t, from: s };
  // Cytoscape's bezier edges are quadratic segments joined at midpoints.
  cps.forEach((cp, i) => {
    const next = cps[i + 1];
    const end = next ? { x: (cp.x + next.x) / 2, y: (cp.y + next.y) / 2 } : t;
    d += ` Q${n(cp.x)} ${n(cp.y)} ${n(end.x)} ${n(end.y)}`;
  });
  return { d, tip: t, from: cps[cps.length - 1] };
}

function arrowHead(tip: { x: number; y: number }, from: { x: number; y: number }, size: number): string {
  const a = Math.atan2(tip.y - from.y, tip.x - from.x);
  const back = { x: tip.x - size * Math.cos(a), y: tip.y - size * Math.sin(a) };
  const w = size * 0.55;
  const l = { x: back.x + w * Math.sin(a), y: back.y - w * Math.cos(a) };
  const r = { x: back.x - w * Math.sin(a), y: back.y + w * Math.cos(a) };
  return `${n(tip.x)},${n(tip.y)} ${n(l.x)},${n(l.y)} ${n(r.x)},${n(r.y)}`;
}

function piePath(cx: number, cy: number, r: number, from: number, to: number): string {
  // Angles in turns, starting at 12 o'clock and going clockwise, as Cytoscape draws pies.
  const at = (t: number) => ({ x: cx + r * Math.sin(t * 2 * Math.PI), y: cy - r * Math.cos(t * 2 * Math.PI) });
  if (to - from >= 0.9999) return `M${n(cx - r)} ${n(cy)} a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0 a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0Z`;
  const a = at(from);
  const b = at(to);
  return `M${n(cx)} ${n(cy)} L${n(a.x)} ${n(a.y)} A${n(r)} ${n(r)} 0 ${to - from > 0.5 ? 1 : 0} 1 ${n(b.x)} ${n(b.y)}Z`;
}

export function mapToSvg(cy: Core, info: ExportInfo): string {
  const W = Math.round(cy.width());
  const H = Math.round(cy.height());
  const zoom = cy.zoom();
  const legend = legendLayout(W, info);
  const font = esc(fontFamily(info.theme.font));
  const lines: string[] = [];
  const shapes: string[] = [];
  const labels: string[] = [];

  cy.edges(":visible").forEach((e) => {
    const opacity = e.effectiveOpacity();
    if (opacity <= 0) return;
    const stroke = e.style("line-color");
    const width = px(e.style("width")) * zoom;
    const { d, tip, from } = edgePath(e);
    lines.push(`<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${n(width)}" stroke-linecap="round" opacity="${n(opacity)}"/>`);
    if (e.style("target-arrow-shape") === "triangle") {
      const size = Math.max(7, width * 3.2) * px(e.style("arrow-scale"));
      lines.push(`<polygon points="${arrowHead(tip, from, size)}" fill="${e.style("target-arrow-color")}" opacity="${n(opacity)}"/>`);
    }
    const label = String(e.style("label") ?? "");
    if (label && e.data("strength") !== undefined) {
      const m = e.renderedMidpoint();
      const size = px(e.style("font-size")) * zoom;
      const w = label.length * size * 0.62 + 8;
      labels.push(
        `<rect x="${n(m.x - w / 2)}" y="${n(m.y - size * 0.75)}" width="${n(w)}" height="${n(size * 1.5)}" rx="${n(size * 0.4)}" fill="${info.theme.paper}"/>`,
        `<text x="${n(m.x)}" y="${n(m.y + size * 0.35)}" text-anchor="middle" font-family="${font}" font-size="${n(size)}" font-weight="600" fill="${e.style("color")}">${esc(label)}</text>`,
      );
    }
  });

  cy.nodes(":visible").forEach((node: NodeSingular) => {
    const opacity = node.effectiveOpacity();
    if (opacity <= 0) return;
    const p = node.renderedPosition();
    const r = (node.width() * zoom) / 2;
    const fill = node.style("background-color");
    const fillOpacity = px(node.style("background-opacity")) || 1;
    const borderWidth = px(node.style("border-width")) * zoom;
    const border = node.style("border-color");
    const dash = node.style("border-style") === "dashed" ? ` stroke-dasharray="${n(borderWidth * 2)} ${n(borderWidth * 1.5)}"` : "";
    const parts: string[] = [];
    if (node.hasClass("multi")) {
      let at = 0;
      for (let i = 1; i <= 8; i++) {
        const share = Number(node.data(`p${i}s`)) / 100;
        if (!share) continue;
        parts.push(`<path d="${piePath(p.x, p.y, r, at, at + share)}" fill="${node.data(`p${i}c`)}"/>`);
        at += share;
      }
    } else {
      parts.push(`<circle cx="${n(p.x)}" cy="${n(p.y)}" r="${n(r)}" fill="${fill}" fill-opacity="${n(fillOpacity)}"/>`);
    }
    if (borderWidth > 0) {
      parts.push(`<circle cx="${n(p.x)}" cy="${n(p.y)}" r="${n(r)}" fill="none" stroke="${border}" stroke-width="${n(borderWidth)}"${dash}/>`);
    }
    shapes.push(`<g opacity="${n(opacity)}">${parts.join("")}</g>`);

    const label = String(node.data("label") ?? "");
    const size = px(node.style("font-size")) * zoom;
    if (label && size >= 7) {
      const y = p.y + r + borderWidth / 2 + px(node.style("text-margin-y")) * zoom + size * 0.9;
      const textOpacity = opacity * (px(node.style("text-opacity")) || 1);
      labels.push(
        `<text x="${n(p.x)}" y="${n(y)}" text-anchor="middle" font-family="${font}" font-size="${n(size)}" font-weight="${node.style("font-weight")}" fill="${node.style("color")}" opacity="${n(textOpacity)}">${esc(label)}</text>`,
      );
    }
  });

  const legendItems = legend.items.map((item) =>
    item.type === "dot"
      ? `<circle cx="${n(item.x)}" cy="${n(H + item.y)}" r="${item.r}" fill="${item.colour}"/>`
      : `<text x="${n(item.x)}" y="${n(H + item.y)}" font-family="${font}" font-size="${item.size}" font-weight="${item.weight}" fill="${item.colour}">${esc(item.text)}</text>`,
  );
  const total = H + legend.height;
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${total}" viewBox="0 0 ${W} ${total}">`,
    `<title>${esc(info.title)}</title>`,
    `<rect id="Background" width="${W}" height="${total}" fill="${info.theme.paper}"/>`,
    `<defs><clipPath id="map-area"><rect width="${W}" height="${H}"/></clipPath></defs>`,
    `<g id="Map" clip-path="url(#map-area)">`,
    `<g id="Lines">${lines.join("")}</g>`,
    `<g id="Sources-and-groups">${shapes.join("")}</g>`,
    `<g id="Labels">${labels.join("")}</g>`,
    `</g>`,
    `<line x1="0" y1="${H}" x2="${W}" y2="${H}" stroke="${info.theme.rule}"/>`,
    `<g id="Legend">${legendItems.join("")}</g>`,
    `</svg>`,
  ].join("\n");
}

/** A PNG at twice the screen resolution: the map as drawn, with the legend under it. */
export async function mapToPng(cy: Core, info: ExportInfo): Promise<Blob> {
  const scale = 2;
  const W = Math.round(cy.width());
  const H = Math.round(cy.height());
  const legend = legendLayout(W, info);
  const image = new Image();
  image.src = cy.png({ full: false, scale, bg: info.theme.paper });
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = W * scale;
  canvas.height = (H + legend.height) * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.fillStyle = info.theme.paper;
  ctx.fillRect(0, 0, W, H + legend.height);
  ctx.drawImage(image, 0, 0, W, H);
  ctx.strokeStyle = info.theme.rule;
  ctx.beginPath();
  ctx.moveTo(0, H + 0.5);
  ctx.lineTo(W, H + 0.5);
  ctx.stroke();
  for (const item of legend.items) {
    if (item.type === "dot") {
      ctx.fillStyle = item.colour;
      ctx.beginPath();
      ctx.arc(item.x, H + item.y, item.r, 0, 2 * Math.PI);
      ctx.fill();
    } else {
      ctx.fillStyle = item.colour;
      ctx.font = `${item.weight} ${item.size}px ${info.theme.font}`;
      ctx.fillText(item.text, item.x, H + item.y);
    }
  }
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't make the image."))), "image/png"));
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
