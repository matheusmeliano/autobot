import { redirect } from "next/navigation";

export default async function AppHomePage() {
  redirect("/app/dashboard");
}
