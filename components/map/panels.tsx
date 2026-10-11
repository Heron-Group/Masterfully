"use client";

import { ArrowLeft, ArrowRight, ChevronRight, X } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { formatAuthors } from "@/lib/dto";
import type { BridgeLink, GroupPair, MapGraph } from "@/lib/map/graph";

// The map's side panel (a bottom sheet on phones): details of what's
// selected, or the Crossovers and Gaps lists when those modes are on.

export type Selected =
  | { kind: "source"; id: string }
  | { kind: "group"; id: string }
  | { kind: "pair"; a: string; b: string }
  | { kind: "link"; from: string; to: string };

export type Lookup = {
  source: Map<string, MapGraph["sources"][number]>;
  group: Map<string, MapGraph["groups"][number]>;
};

type Pick = (kind: "source" | "group", id: string) => void;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-faint">{children}</p>;
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="mb-1 text-[11px] font-medium uppercase tracking-wider text-faint">{children}</h3>;
}

function Dot({ colour, size = "size-2.5" }: { colour: string; size?: string }) {
  return <span className={`${size} shrink-0 rounded-full`} style={{ background: colour }} aria-hidden="true" />;
}

function GroupChip({ id, lookup, onPick }: { id: string; lookup: Lookup; onPick: Pick }) {
  const g = lookup.group.get(id);
  if (!g) return null;
  return (
    <button
      type="button"
      onClick={() => onPick("group", id)}
      className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-accent-soft/70 px-2 py-0.5 text-[13px] hover:bg-accent-soft"
    >
      <Dot colour={g.colour} />
      <span className="truncate">{g.title}</span>
    </button>
  );
}

/** A source as a clickable row, with an optional icon and second line. */
function SourceRow({ id, lookup, onPick, icon, detail }: { id: string; lookup: Lookup; onPick: Pick; icon?: ReactNode; detail?: ReactNode }) {
  const s = lookup.source.get(id);
  if (!s) return null;
  return (
    <button type="button" onClick={() => onPick("source", id)} className="flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left hover:bg-accent-soft/60">
      {icon}
      <span className="min-w-0">
        <span className="block truncate text-ink">{s.title}</span>
        {detail && <span className="block truncate text-xs text-muted">{detail}</span>}
      </span>
    </button>
  );
}

const groupNames = (ids: string[], lookup: Lookup) => ids.map((g) => lookup.group.get(g)?.title ?? g).join(", ");

/** "Source A (Group X) ↔ Source B (Group Y)", each source clickable. */
function BridgeRow({ bridge, lookup, onPick }: { bridge: BridgeLink; lookup: Lookup; onPick: Pick }) {
  const side = (id: string, groups: string[]) => (
    <button type="button" onClick={() => onPick("source", id)} className="min-w-0 text-left hover:underline">
      <span className="text-ink">{lookup.source.get(id)?.shortTitle ?? id}</span> <span className="text-muted">({groupNames(groups, lookup)})</span>
    </button>
  );
  return (
    <li className="rounded-md px-1.5 py-1 text-[13px] leading-snug">
      {side(bridge.a, bridge.aGroups)} <span className="text-faint">↔</span> {side(bridge.b, bridge.bGroups)}
    </li>
  );
}

function PairLists({ pair, lookup, onPick }: { pair: GroupPair; lookup: Lookup; onPick: Pick }) {
  return (
    <>
      <section className="mt-4">
        <SectionTitle>Shared sources ({pair.shared.length})</SectionTitle>
        {pair.shared.length ? (
          <ul>
            {pair.shared.map((id) => (
              <li key={id}>
                <SourceRow id={id} lookup={lookup} onPick={onPick} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-1.5 text-sm text-faint">None.</p>
        )}
      </section>
      <section className="mt-4">
        <SectionTitle>Bridge links ({pair.bridges.length})</SectionTitle>
        {pair.bridges.length ? (
          <ul>
            {pair.bridges.map((b) => (
              <BridgeRow key={`${b.a}>${b.b}`} bridge={b} lookup={lookup} onPick={onPick} />
            ))}
          </ul>
        ) : (
          <p className="px-1.5 text-sm text-faint">None.</p>
        )}
      </section>
    </>
  );
}

function OpenLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="mt-6 inline-flex items-center gap-1.5 text-sm text-accent-text underline underline-offset-2">
      {children}
    </Link>
  );
}

function SourceDetails({ id, graph, lookup, onPick }: { id: string; graph: MapGraph; lookup: Lookup; onPick: Pick }) {
  const s = lookup.source.get(id);
  if (!s) return null;
  const out = graph.links.filter((l) => l.from === s.id);
  const into = graph.links.filter((l) => l.to === s.id);
  const phrases = (labels: string[]) => (labels.length ? labels.map((p) => `“${p}”`).join(", ") : undefined);
  const arrow = (Icon: typeof ArrowRight) => <Icon size={14} className="mt-0.5 shrink-0 text-faint" aria-hidden="true" />;
  return (
    <>
      <Eyebrow>
        Source
        {s.hub && <span className="rounded bg-ink px-1 py-px text-[10px] text-paper">Hub</span>}
        {s.groups.length >= 2 && <span className="rounded bg-accent-soft px-1 py-px text-[10px] text-ink">Shared</span>}
      </Eyebrow>
      <h2 className="mt-1 font-serif text-xl leading-snug">{s.title}</h2>
      {(s.authors.length > 0 || s.year) && <p className="mt-1 text-sm text-muted">{[formatAuthors(s.authors), s.year].filter(Boolean).join(" · ")}</p>}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {s.groups.length ? s.groups.map((g) => <GroupChip key={g} id={g} lookup={lookup} onPick={onPick} />) : <span className="text-sm text-faint">Not in a group</span>}
      </div>
      {s.notesPreview && <p className="mt-4 text-sm leading-relaxed text-ink">{s.notesPreview}</p>}
      {out.length > 0 && (
        <section className="mt-5">
          <SectionTitle>Links to</SectionTitle>
          <ul>
            {out.map((l) => (
              <li key={l.to}>
                <SourceRow id={l.to} lookup={lookup} onPick={onPick} icon={arrow(ArrowRight)} detail={phrases(l.labels)} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {into.length > 0 && (
        <section className="mt-4">
          <SectionTitle>Linked from</SectionTitle>
          <ul>
            {into.map((l) => (
              <li key={l.from}>
                <SourceRow id={l.from} lookup={lookup} onPick={onPick} icon={arrow(ArrowLeft)} detail={phrases(l.labels)} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {!out.length && !into.length && <p className="mt-5 text-sm text-faint">No links to or from other sources yet.</p>}
      <OpenLink href={`/library/${s.id}`}>Open source</OpenLink>
    </>
  );
}

function GroupDetails({ id, graph, lookup, onPick, onSelect }: { id: string; graph: MapGraph; lookup: Lookup; onPick: Pick; onSelect: (s: Selected) => void }) {
  const g = lookup.group.get(id);
  if (!g) return null;
  const crossings = graph.crossover.pairs.filter((p) => p.a === g.id || p.b === g.id);
  return (
    <>
      <Eyebrow>
        <Dot colour={g.colour} />
        Reading group
      </Eyebrow>
      <h2 className="mt-1 font-serif text-xl leading-snug">{g.title}</h2>
      <p className="mt-1 text-sm text-muted">{plural(g.sources.length, "source")}</p>
      {g.overviewPreview && <p className="mt-4 text-sm leading-relaxed text-ink">{g.overviewPreview}</p>}
      <section className="mt-5">
        <SectionTitle>Crosses over with</SectionTitle>
        {crossings.length ? (
          <ul className="space-y-1">
            {crossings.map((p) => {
              const other = p.a === g.id ? p.b : p.a;
              return (
                <li key={other} className="flex items-center justify-between gap-2">
                  <GroupChip id={other} lookup={lookup} onPick={onPick} />
                  <button type="button" onClick={() => onSelect({ kind: "pair", a: p.a, b: p.b })} className="shrink-0 text-xs text-muted hover:text-ink hover:underline">
                    {p.shared.length} shared · {plural(p.bridges.length, "bridge")}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-faint">No shared sources or bridge links yet.</p>
        )}
      </section>
      <OpenLink href={`/groups/${g.id}`}>Open group</OpenLink>
    </>
  );
}

function PairDetails({ a, b, graph, lookup, onPick }: { a: string; b: string; graph: MapGraph; lookup: Lookup; onPick: Pick }) {
  const pair = graph.crossover.pairs.find((p) => p.a === a && p.b === b);
  if (!pair) return null;
  return (
    <>
      <Eyebrow>Crossover</Eyebrow>
      <h2 className="mt-2 flex flex-wrap items-center gap-1.5">
        <GroupChip id={a} lookup={lookup} onPick={onPick} />
        <span className="text-faint">↔</span>
        <GroupChip id={b} lookup={lookup} onPick={onPick} />
      </h2>
      <p className="mt-2 text-sm text-muted">
        Strength {pair.strength}: {plural(pair.shared.length, "shared source")} and {plural(pair.bridges.length, "bridge link")}.
      </p>
      <PairLists pair={pair} lookup={lookup} onPick={onPick} />
    </>
  );
}

function LinkDetails({ from, to, graph, lookup, onPick }: { from: string; to: string; graph: MapGraph; lookup: Lookup; onPick: Pick }) {
  const link = graph.links.find((l) => l.from === from && l.to === to);
  if (!link) return null;
  const bridge = graph.crossover.bridges.find((x) => (x.a === from && x.b === to) || (x.a === to && x.b === from));
  return (
    <>
      <Eyebrow>Link{link.count > 1 ? ` · ${link.count} times` : ""}</Eyebrow>
      <ul className="mt-2">
        <li>
          <SourceRow id={from} lookup={lookup} onPick={onPick} />
        </li>
        <li className="px-1.5 text-faint" aria-label="links to">
          <ArrowRight size={14} className="rotate-90" aria-hidden="true" />
        </li>
        <li>
          <SourceRow id={to} lookup={lookup} onPick={onPick} />
        </li>
      </ul>
      {link.labels.length > 0 && (
        <section className="mt-4">
          <SectionTitle>Linked words</SectionTitle>
          <ul className="space-y-1 px-1.5 text-sm">
            {link.labels.map((l) => (
              <li key={l}>“{l}”</li>
            ))}
          </ul>
        </section>
      )}
      {bridge && (
        <p className="mt-4 rounded-md bg-accent-soft/60 px-2.5 py-2 text-[13px] leading-snug">
          A <strong className="font-medium">bridge link</strong>: these sources share no reading group ({groupNames(bridge.aGroups, lookup)} and{" "}
          {groupNames(bridge.bGroups, lookup)}).
        </p>
      )}
    </>
  );
}

/** Crossover mode's list: group pairs, shared sources and bridge links. */
function CrossoversPanel({ graph, lookup, onPick }: { graph: MapGraph; lookup: Lookup; onPick: Pick }) {
  const { pairs, shared, bridges } = graph.crossover;
  return (
    <>
      <h2 className="font-serif text-xl">Crossovers</h2>
      <p className="mt-1 text-sm text-muted">
        Shared sources are in two or more groups. Bridge links join sources that share no group.
      </p>
      <section className="mt-5">
        <SectionTitle>Group pairs ({pairs.length})</SectionTitle>
        {pairs.length ? (
          <ul className="space-y-1">
            {pairs.map((p) => (
              <li key={`${p.a}>${p.b}`}>
                <details className="group/pair rounded-md">
                  <summary className="flex cursor-pointer list-none items-start gap-1.5 rounded-md px-1.5 py-1 text-[13px] hover:bg-accent-soft/60 [&::-webkit-details-marker]:hidden">
                    <ChevronRight size={14} className="mt-0.5 shrink-0 text-faint transition-transform group-open/pair:rotate-90" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      {[p.a, p.b].map((id, i) => (
                        <span key={id} className="flex items-center gap-1.5">
                          <Dot colour={lookup.group.get(id)?.colour ?? ""} />
                          <span className="min-w-0 truncate">{lookup.group.get(id)?.title}</span>
                          {i === 0 && <span className="sr-only">and</span>}
                        </span>
                      ))}
                    </span>
                    <span className="shrink-0 tabular-nums text-muted" title="Crossover strength">
                      {p.strength}
                    </span>
                  </summary>
                  <div className="pb-2 pl-5">
                    <PairLists pair={p} lookup={lookup} onPick={onPick} />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-1.5 text-sm text-faint">No groups cross over yet.</p>
        )}
      </section>
      <section className="mt-5">
        <SectionTitle>Shared sources ({shared.length})</SectionTitle>
        {shared.length ? (
          <ul>
            {shared.map((x) => (
              <li key={x.source}>
                <SourceRow id={x.source} lookup={lookup} onPick={onPick} detail={`${x.groups.length} groups: ${groupNames(x.groups, lookup)}`} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-1.5 text-sm text-faint">No source is in more than one group.</p>
        )}
      </section>
      <section className="mt-5">
        <SectionTitle>Bridge links ({bridges.length})</SectionTitle>
        {bridges.length ? (
          <ul>
            {bridges.map((b) => (
              <BridgeRow key={`${b.a}>${b.b}`} bridge={b} lookup={lookup} onPick={onPick} />
            ))}
          </ul>
        ) : (
          <p className="px-1.5 text-sm text-faint">No links between sources in different groups.</p>
        )}
      </section>
    </>
  );
}

/** Gaps mode's list: isolated and unlinked sources. */
function GapsPanel({ graph, lookup, onPick }: { graph: MapGraph; lookup: Lookup; onPick: Pick }) {
  const isolated = graph.sources.filter((s) => s.isolated);
  const unlinked = graph.sources.filter((s) => s.unlinked);
  return (
    <>
      <h2 className="font-serif text-xl">Gaps</h2>
      <p className="mt-1 text-sm text-muted">Sources that aren&apos;t connected to anything yet.</p>
      <section className="mt-5">
        <SectionTitle>
          Isolated ({isolated.length}) <span className="normal-case tracking-normal">· no links, no group · dashed ring</span>
        </SectionTitle>
        {isolated.length ? (
          <ul>
            {isolated.map((s) => (
              <li key={s.id}>
                <SourceRow id={s.id} lookup={lookup} onPick={onPick} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-1.5 text-sm text-faint">None.</p>
        )}
      </section>
      <section className="mt-5">
        <SectionTitle>
          Unlinked ({unlinked.length}) <span className="normal-case tracking-normal">· in a group, no links</span>
        </SectionTitle>
        {unlinked.length ? (
          <ul>
            {unlinked.map((s) => (
              <li key={s.id}>
                <SourceRow id={s.id} lookup={lookup} onPick={onPick} detail={groupNames(s.groups, lookup)} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-1.5 text-sm text-faint">None.</p>
        )}
      </section>
    </>
  );
}

export function SidePanel({
  graph,
  lookup,
  selected,
  mode,
  onClose,
  onPick,
  onSelect,
}: {
  graph: MapGraph;
  lookup: Lookup;
  selected: Selected | null;
  mode: "crossover" | "gaps" | null;
  onClose: () => void;
  onPick: Pick;
  onSelect: (s: Selected) => void;
}) {
  let body: ReactNode = null;
  let label = "Details";
  if (selected?.kind === "source") body = <SourceDetails id={selected.id} graph={graph} lookup={lookup} onPick={onPick} />;
  else if (selected?.kind === "group") body = <GroupDetails id={selected.id} graph={graph} lookup={lookup} onPick={onPick} onSelect={onSelect} />;
  else if (selected?.kind === "pair") body = <PairDetails a={selected.a} b={selected.b} graph={graph} lookup={lookup} onPick={onPick} />;
  else if (selected?.kind === "link") body = <LinkDetails from={selected.from} to={selected.to} graph={graph} lookup={lookup} onPick={onPick} />;
  else if (mode === "crossover") {
    label = "Crossovers";
    body = <CrossoversPanel graph={graph} lookup={lookup} onPick={onPick} />;
  } else if (mode === "gaps") {
    label = "Gaps";
    body = <GapsPanel graph={graph} lookup={lookup} onPick={onPick} />;
  }
  if (!body) return null;
  return (
    <aside
      aria-label={label}
      className="z-20 max-h-[50%] shrink-0 overflow-y-auto border-t border-rule bg-surface p-5 shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.15)] md:max-h-none md:w-80 md:border-l md:border-t-0 md:shadow-none"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={selected ? "Close details" : `Close ${label.toLowerCase()}`}
        className="float-right -mr-2 -mt-2 rounded-md p-1.5 text-muted hover:bg-accent-soft hover:text-ink"
      >
        <X size={16} aria-hidden="true" />
      </button>
      {selected && mode && (
        <button type="button" onClick={onClose} className="-ml-1 mb-3 inline-flex items-center gap-1 text-xs text-muted hover:text-ink">
          <ArrowLeft size={12} aria-hidden="true" />
          Back to {mode === "crossover" ? "Crossovers" : "Gaps"}
        </button>
      )}
      {body}
    </aside>
  );
}
