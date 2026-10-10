import Link from "next/link";
import { Suspense } from "react";
import { NavLinks, NavList } from "@/components/nav-links";
import { SyncStatus } from "@/components/sync-status";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * App shell: a left-hand sidebar on wider screens, a compact icon bar on
 * phones. `--header-height` (used by the journal to fill the screen) is the
 * phone bar's height, and zero when the sidebar is showing.
 */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="app-shell min-h-dvh md:pl-56">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r border-rule bg-paper pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-[env(safe-area-inset-left)] pt-[max(1rem,env(safe-area-inset-top))] md:flex">
        <Link href="/journal" className="mb-6 px-5 font-serif text-xl tracking-tight">
          Research
        </Link>
        <nav aria-label="Main" className="px-3">
          <Suspense fallback={<NavList variant="sidebar" />}>
            <NavLinks variant="sidebar" />
          </Suspense>
        </nav>
        <div className="mt-auto flex items-center justify-between px-3">
          <SyncStatus placement="up" />
          <ThemeToggle />
        </div>
      </aside>

      <header className="sticky top-0 z-20 border-b border-rule bg-paper/90 pt-[env(safe-area-inset-top)] backdrop-blur md:hidden">
        <nav aria-label="Main" className="flex h-12 items-center gap-1 pl-[max(0.5rem,env(safe-area-inset-left))] pr-[max(0.5rem,env(safe-area-inset-right))]">
          <div className="min-w-0 flex-1 overflow-x-auto">
            <Suspense fallback={<NavList variant="bar" />}>
              <NavLinks variant="bar" />
            </Suspense>
          </div>
          <SyncStatus />
          <ThemeToggle />
        </nav>
      </header>

      {/* Leaves room for the reading panel when it is open (see reader-panel). */}
      <div className="flex min-h-[calc(100dvh-var(--header-height))] flex-col transition-[padding] lg:pr-[var(--reader-width,0px)]">
        {children}
      </div>
    </div>
  );
}
