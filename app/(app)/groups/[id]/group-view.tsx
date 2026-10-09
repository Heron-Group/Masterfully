"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { MarkdownEditor } from "@/components/markdown-editor";
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
      <div className="mt-6 rounded-md border border-warn/40 bg-warn/10 px-4 py-3 text-sm">
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

function Title({ group }: { group: GroupDto }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(group.title);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  if (!editing) {
    return (
      <header className="flex flex-wrap items-baseline gap-x-3">
        <h1 className="font-serif text-[1.9rem] leading-tight tracking-tight">{group.title}</h1>
        <button type="button" onClick={() => setEditing(true)} className={ui.btnGhost}>
          Rename
        </button>
      </header>
    );
  }
  return (
    <form
      className="flex flex-wrap gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await renameGroup(group.id, title);
          setResult(r);
          if (r.ok) {
            changed();
            setEditing(false);
          }
        });
      }}
    >
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        aria-label="Group title"
        autoFocus
        className={`${ui.input} max-w-lg font-serif text-xl`}
      />
      <button type="submit" disabled={pending || !title.trim()} className={ui.btnPrimary}>
        Save
      </button>
      <button type="button" onClick={() => setEditing(false)} className={ui.btnGhost}>
        Cancel
      </button>
      {result && !result.ok && <p role="alert" className="w-full text-sm text-danger">{result.error}</p>}
    </form>
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
      <h2 id="overview-heading" className={`${ui.h2} mb-3`}>
        My overview
      </h2>
      <MarkdownEditor
        value={overview}
        onChange={setOverview}
        placeholder="What this group is about, in your own words. Saved automatically."
        minRows={4}
        toolbar={<span className="text-xs"><SaveStatus state={state} error={error} onRetry={() => void flush()} /></span>}
        textareaProps={{ "aria-label": "My overview", onBlur: () => void flush() }}
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
        <div role="alertdialog" aria-label="Delete group" className="rounded-md border border-danger/30 bg-danger/5 p-4 text-sm">
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
