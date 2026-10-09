import Link from "next/link";
import { Suspense } from "react";
import { NavLinks, NavList } from "@/components/nav-links";
import { SyncStatus } from "@/components/sync-status";
import { ThemeToggle } from "@/components/theme-toggle";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-col" style={{ ["--header-height" as string]: "calc(3rem + 1px + env(safe-area-inset-top))" }}>
      <header className="sticky top-0 z-20 border-b border-rule bg-paper/90 pt-[env(safe-area-inset-top)] backdrop-blur">
        <nav className="mx-auto flex h-12 max-w-3xl items-center gap-1 px-2 sm:gap-3 sm:px-4 pl-[max(0.5rem,env(safe-area-inset-left))] pr-[max(0.5rem,env(safe-area-inset-right))]">
          <Link href="/journal" className="mr-3 hidden font-serif text-lg tracking-tight sm:block">
            Research
          </Link>
          <div className="min-w-0 flex-1 overflow-x-auto">
            <Suspense fallback={<NavList />}>
              <NavLinks />
            </Suspense>
          </div>
          <SyncStatus />
          <ThemeToggle />
        </nav>
      </header>
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}
