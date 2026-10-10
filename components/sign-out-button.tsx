import { LogOut } from "lucide-react";
import { logoutAction } from "@/app/login/actions";
import { ui } from "./ui";

export function SignOutButton() {
  return (
    <form action={logoutAction}>
      <button type="submit" className={ui.btnSoft}>
        <LogOut size={15} strokeWidth={1.8} aria-hidden="true" />
        Sign out
      </button>
    </form>
  );
}
