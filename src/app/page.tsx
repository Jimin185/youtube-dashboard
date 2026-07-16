import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import Dashboard from "@/components/Dashboard";

export default async function Home() {
  const session = await getSession();
  if (!session.userId) redirect("/login");
  return <Dashboard userName={session.name ?? ""} />;
}
