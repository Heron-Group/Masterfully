"use client";

import { Library, NotebookPen, Settings, SquareStack, StickyNote, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export const NAV_ITEMS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/journal", label: "Journal", icon: NotebookPen },
  { href: "/notes", label: "Notes", icon: StickyNote },
  { href: "/library", label: "Library", icon: Library },
  { href: "/groups", label: "Groups", icon: SquareStack },
  { href: "/settings", label: "Settings", icon: Settings },
];


type Variant = "sidebar" | "bar";
/** In the sidebar, Settings sits apart at the bottom; the phone bar shows everything. */
type Part = "all" | "main" | "footer";

function itemsFor(part: Part) {
  if (part === "all") return NAV_ITEMS;
  return NAV_ITEMS.filter((i) => (i.href === "/settings") === (part === "footer"));
}

export function NavLinks({ variant, part = "all" }: { variant: Variant; part?: Part }) {
  const pathname = usePathname();
  return (
    <NavList variant={variant} part={part} active={(href) => pathname === href || pathname.startsWith(`${href}/`)} />
  );
}

/** Also used as the Suspense fallback, with nothing marked active. */
export function NavList({
  variant,
  part = "all",
  active = () => false,
}: {
  variant: Variant;
  part?: Part;
  active?: (href: string) => boolean;
}) {
  const items = itemsFor(part);
  if (variant === "bar") {
    return (
      <ul className="flex items-center gap-1">
        {items.map(({ href, label, icon: Icon }) => {
          const current = active(href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={current ? "page" : undefined}
                aria-label={label}
                title={label}
                className={`flex h-9 items-center gap-1.5 rounded-md px-2.5 text-sm transition-colors ${
                  current ? "bg-accent-soft text-ink" : "text-muted hover:bg-accent-soft/60 hover:text-ink"
                }`}
              >
                <Icon size={18} strokeWidth={1.6} aria-hidden="true" className={current ? "text-accent" : undefined} />
                <span className={current ? "inline" : "sr-only"}>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    );
  }
  return (
    <ul className="space-y-0.5">
      {items.map(({ href, label, icon: Icon }) => {
        const current = active(href);
        return (
          <li key={href}>
            <Link
              href={href}
              aria-current={current ? "page" : undefined}
              className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[15px] transition-colors ${
                current ? "bg-accent-soft font-medium text-ink" : "text-muted hover:bg-accent-soft/60 hover:text-ink"
              }`}
            >
              <Icon size={18} strokeWidth={1.6} aria-hidden="true" className={current ? "text-accent" : undefined} />
              {label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
