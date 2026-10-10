import { Library, SquareStack } from "lucide-react";
import Link from "next/link";

const SECTIONS = {
  library: { href: "/library", label: "Library", icon: Library },
  groups: { href: "/groups", label: "Reading groups", icon: SquareStack },
} as const;

/** A subtle button back to the section a page belongs to, with its icon. */
export function BackLink({ to }: { to: keyof typeof SECTIONS }) {
  const { href, label, icon: Icon } = SECTIONS[to];
  return (
    <Link
      href={href}
      className="-ml-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted transition-colors hover:bg-accent-soft hover:text-ink"
    >
      <Icon size={15} strokeWidth={1.7} aria-hidden="true" />
      {label}
    </Link>
  );
}
