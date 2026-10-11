import cytoscape, { type ElementDefinition } from "cytoscape";
import fcose from "cytoscape-fcose";
import { LAYOUT_STYLE, layoutFor, withSeed, type MapViewName, type Pins } from "./elements";

// The full source-network layout for large maps, off the main thread so the
// page stays responsive while it runs (a few seconds at 500 sources). Same
// options and seed as on the page, so the result is the same either way.

cytoscape.use(fcose);

export type LayoutRequest = { elements: ElementDefinition[]; view: MapViewName; pins: Pins; seed: number };
export type LayoutResult = { positions: Pins };

self.onmessage = (event: MessageEvent<LayoutRequest>) => {
  const { elements, view, pins, seed } = event.data;
  const cy = cytoscape({ headless: true, styleEnabled: true, elements, style: LAYOUT_STYLE });
  const ids = new Set(cy.nodes().map((n) => n.id()));
  withSeed(seed, () => cy.layout(layoutFor(view, pins, ids) as never).run());
  const positions: Pins = {};
  cy.nodes().forEach((n) => {
    const p = n.position();
    positions[n.id()] = { x: p.x, y: p.y };
  });
  cy.destroy();
  (self as unknown as Worker).postMessage({ positions } satisfies LayoutResult);
};
