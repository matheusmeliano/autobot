import { redirect } from "next/navigation";

export const permanent = true;

export default function AdminPage() {
  redirect("/app/admin");
}
