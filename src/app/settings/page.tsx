import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import SettingsForm from "@/components/SettingsForm";

export default async function SettingsPage() {
  const session = await getSession();
  if (!session.userId) redirect("/login");
  return <SettingsForm />;
}
