import { redirect } from "next/navigation";

// The sleep-only dashboard has been unified into the tabbed `/dashboard`
// (Nights/Naps). Preserve this path by redirecting to the Nights view.
export default function SleepDashboardRedirect() {
  redirect("/dashboard");
}
