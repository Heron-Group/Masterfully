"use client";

import { Fragment, useEffect, useState, type ReactNode } from "react";

/**
 * Starts its contents afresh each time the page is shown. Next.js keeps a
 * page that's been left mounted but hidden, so a "new source" page would
 * otherwise come back showing what was added last time. Leaving the page
 * (or hiding it) changes the key, so the next visit is a blank form.
 */
export function FreshOnEachVisit({ children }: { children: ReactNode }) {
  const [visit, setVisit] = useState(0);
  useEffect(() => () => setVisit((v) => v + 1), []);
  return <Fragment key={visit}>{children}</Fragment>;
}
