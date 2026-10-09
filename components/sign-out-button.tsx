import { logoutAction } from "@/app/login/actions";

export function SignOutButton() {
  return (
    <form action={logoutAction}>
      <button
        type="submit"
        className="rounded-md px-2.5 py-1 text-sm text-muted transition-colors hover:bg-accent-soft hover:text-ink"
      >
        Sign out
      </button>
    </form>
  );
}
