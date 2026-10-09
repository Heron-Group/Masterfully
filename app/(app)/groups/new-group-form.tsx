"use client";

import { useState, useTransition } from "react";
import { CONTENT_CHANGED_EVENT } from "@/components/sync-status";
import { fieldBase } from "@/components/inline-fields";
import { ui } from "@/components/ui";
import { createGroup } from "./actions";

export function NewGroupForm() {
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return;
        start(async () => {
          window.dispatchEvent(new Event(CONTENT_CHANGED_EVENT));
          const r = await createGroup(title);
          if (!r.ok) setError(r.error);
        });
      }}
    >
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="+ New group"
        aria-label="New group title"
        className={`${fieldBase} font-serif text-lg`}
      />
      {title.trim() && (
        <button type="submit" disabled={pending} className={`${ui.btnPrimary} shrink-0`}>
          {pending ? "Creating…" : "Create group"}
        </button>
      )}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </form>
  );
}
