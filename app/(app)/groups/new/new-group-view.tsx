"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { InlineTitle } from "@/components/inline-fields";
import { LiveEditor } from "@/components/live-editor/live-editor";
import { CONTENT_CHANGED_EVENT } from "@/components/sync-status";
import { ui } from "@/components/ui";
import { createGroup, saveGroupOverview } from "../actions";

/**
 * The same layout as a group page, but blank. Nothing is saved until the
 * group has a title; then it is created (with any overview written so far)
 * and the page becomes that group's page.
 */
export function NewGroupView() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const overview = useRef("");
  const [createdId, setCreatedId] = useState<string | null>(null);
  const article = useRef<HTMLElement>(null);
  const pending = useRef(0);

  // After creation, open the group's own page once nothing is being edited.
  const maybeOpen = useCallback(() => {
    if (!createdId || pending.current) return;
    const active = document.activeElement as HTMLElement | null;
    const editing = !!active && !!article.current?.contains(active) && active.matches("input, textarea, [contenteditable=true]");
    if (!editing) router.replace(`/groups/${createdId}`);
  }, [createdId, router]);

  useEffect(() => {
    if (!createdId) return;
    maybeOpen();
    const onFocusOut = () => setTimeout(maybeOpen, 0);
    const el = article.current;
    el?.addEventListener("focusout", onFocusOut);
    return () => el?.removeEventListener("focusout", onFocusOut);
  }, [createdId, maybeOpen]);

  async function saveOverview() {
    if (!createdId) return;
    pending.current++;
    try {
      const r = await saveGroupOverview(createdId, overview.current);
      if (!r.ok) setError(r.error);
    } finally {
      pending.current--;
      maybeOpen();
    }
  }

  async function create(title: string) {
    if (creating || !title.trim()) return;
    setCreating(true);
    setError(null);
    const r = await createGroup(title, overview.current);
    if (r.ok) {
      window.dispatchEvent(new Event(CONTENT_CHANGED_EVENT));
      setCreatedId(r.id);
    } else {
      setError(r.error);
      setCreating(false);
    }
  }

  return (
    <article ref={article} className="mt-4 space-y-12">
      <header>
        <h1 className="sr-only">New group</h1>
        <InlineTitle value="" onSave={(t) => void create(t)} ariaLabel="Group title" autoFocus />
        <div className="mt-1 flex flex-wrap items-center text-[13px] text-muted">
          <span className="pr-1.5">0 sources</span>
          <span aria-hidden="true" className="px-0.5 text-faint">·</span>
          <span className={`px-1.5 ${error ? "text-danger" : "text-faint"}`} role={error ? "alert" : "status"}>
            {error ?? (createdId ? "Saved" : creating ? "Creating…" : "Give the group a title to save it")}
          </span>
        </div>
      </header>
      <section aria-labelledby="overview-heading">
        <h2 id="overview-heading" className={`${ui.h2} mb-3`}>
          My overview
        </h2>
        <LiveEditor
          value=""
          onChange={(v) => (overview.current = v)}
          onBlur={() => void saveOverview()}
          placeholder="What this group is about, in your own words…"
          ariaLabel="My overview"
          className="min-h-16"
        />
      </section>
      <section aria-labelledby="sources-heading">
        <h2 id="sources-heading" className={`${ui.h2} mb-3`}>
          Sources (0)
        </h2>
        <p className="text-sm text-faint">Add sources once the group has a title.</p>
      </section>
    </article>
  );
}
