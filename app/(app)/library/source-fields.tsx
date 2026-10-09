"use client";

import { useId, type ReactNode } from "react";
import { ui } from "@/components/ui";
import { SOURCE_TYPE_OPTIONS, type SourceDto } from "@/lib/dto";

function Field({ label, className, children }: { label: ReactNode; className: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className={ui.label}>
        {label}
      </label>
      {children(id)}
    </div>
  );
}

/** Title, authors, year, type and link inputs, shared by the add and edit forms. */
export function SourceFields({ source }: { source?: Partial<SourceDto> }) {
  return (
    <div className="grid gap-4 sm:grid-cols-6">
      <Field label="Title" className="sm:col-span-6">
        {(id) => <input id={id} name="title" required defaultValue={source?.title} className={`${ui.input} font-serif text-[17px]`} autoComplete="off" />}
      </Field>
      <Field label={<>Authors <span className="text-faint">— one per line, “Surname, Firstname”</span></>} className="sm:col-span-6">
        {(id) => (
          <textarea
            id={id}
            name="authors"
            rows={Math.max(2, (source?.authors?.length ?? 0) + 1)}
            defaultValue={source?.authors?.join("\n")}
            className={`${ui.input} resize-y`}
          />
        )}
      </Field>
      <Field label="Year" className="sm:col-span-2">
        {(id) => <input id={id} name="year" inputMode="numeric" pattern="[0-9]*" defaultValue={source?.year ?? ""} className={ui.input} />}
      </Field>
      <Field label="Type" className="sm:col-span-4">
        {(id) => (
          <select id={id} name="type" defaultValue={source?.type ?? "article"} className={ui.input}>
            {SOURCE_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Link" className="sm:col-span-6">
        {(id) => <input id={id} name="url" type="url" placeholder="https://" defaultValue={source?.url ?? ""} className={ui.input} />}
      </Field>
    </div>
  );
}
