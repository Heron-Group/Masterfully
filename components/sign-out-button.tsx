import { logoutAction } from "@/app/login/actions";

export function SignOutButton() {
  return (
    <form action={logoutAction}>
      <button
        type="submit"
        className="rounded-md border border-rule px-3 py-1.5 text-sm text-ink transition-colors hover:bg-accent-soft"
      >
        Sign out
      </button>
    </form>
  );
}
