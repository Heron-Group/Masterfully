"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { InlineTitle, useInlineSave } from "@/components/inline-fields";
import { LiveEditor } from "@/components/live-editor/live-editor";
import { CONTENT_CHANGED_EVENT } from "@/components/sync-status";
import { ui } from "@/components/ui";
import { SaveStatus, useAutosave } from "@/components/use-autosave";
import type { GroupDto } from "@/lib/dto";
import { deleteGroup, renameGroup, saveGroupOverview, type ActionResult } from "../actions";
import { GroupSources, type LibraryItem } from "./group-sources";
import { GroupSummaryPanel } from "./group-summary";

export function changed() {
  window.dispatchEvent(new Event(CONTENT_CHANGED_EVENT));
}

export function GroupView({ group, library }: { group: GroupDto; library: LibraryItem[] }) {
  if (group.problem) {
    return (
      <div className="mt-6 rounded-md bg-warn/10 px-4 py-3 text-sm">
        <p className="font-medium">This group&apos;s file can&apos;t be read.</p>
        <p className="mt-1 text-muted">
          The frontmatter in <code>groups/{group.id}.md</code> has an error ({group.problem}). Fix it in a text editor;
          the app won&apos;t change the file until then.
        </p>
      </div>
    );
  }
  return (
    <article className="mt-4 space-y-12">
      <Title group={group} />
      <Overview group={group} />
      <GroupSummaryPanel group={group} />
      <GroupSources group={group} library={library} />
      <DeleteGroup group={group} />
    </article>
  );
}

/** The group's title, renamed in place. The file name never changes. */
function Title({ group }: { group: GroupDto }) {
  const { save, label, isError } = useInlineSave();
  return (
    <header>
      <h1 className="sr-only">{group.title}</h1>
      <InlineTitle
        value={group.title}
        ariaLabel="Group title"
        onSave={(title) =>
          void save(async () => {
            const r = await renameGroup(group.id, title);
            if (r.ok) changed();
            return r;
          })
        }
      />
      <p role={isError ? "alert" : "status"} className={`mt-1 h-4 text-xs ${isError ? "text-danger" : "text-faint"}`}>
        {label}
      </p>
    </header>
  );
}

function Overview({ group }: { group: GroupDto }) {
  const [overview, setOverview] = useState(group.overview);
  const { state, error, flush } = useAutosave(overview, async (value) => {
    const r = await saveGroupOverview(group.id, value);
    if (r.ok) changed();
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  });
  return (
    <section aria-labelledby="overview-heading">
      <div className="mb-3 flex items-baseline gap-3">
        <h2 id="overview-heading" className={ui.h2}>
          My overview
        </h2>
        <span className="text-xs">
          <SaveStatus state={state} error={error} onRetry={() => void flush()} />
        </span>
      </div>
      <LiveEditor
        value={overview}
        onChange={setOverview}
        onBlur={() => void flush()}
        placeholder="What this group is about, in your own words…"
        ariaLabel="My overview"
        className="min-h-16"
      />
    </section>
  );
}

function DeleteGroup({ group }: { group: GroupDto }) {
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <section className="border-t border-rule pt-6">
      {confirming ? (
        <div role="alertdialog" aria-label="Delete group" className="rounded-md bg-danger/5 p-4 text-sm">
          <p>
            Delete the group <strong>{group.title}</strong>? Its {group.sources.length} source
            {group.sources.length === 1 ? "" : "s"} stay in your <Link href="/library" className="underline">library</Link>; only
            the grouping, your overview and group notes are removed.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  changed();
                  setResult(await deleteGroup(group.id));
                })
              }
              className={ui.btnDanger}
            >
              {pending ? "Deleting…" : "Delete group"}
            </button>
            <button type="button" onClick={() => setConfirming(false)} className={ui.btnGhost}>
              Cancel
            </button>
          </div>
          {result && !result.ok && <p role="alert" className="mt-2 text-danger">{result.error}</p>}
        </div>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className="text-sm text-muted hover:text-danger">
          Delete group…
        </button>
      )}
    </section>
  );
}
