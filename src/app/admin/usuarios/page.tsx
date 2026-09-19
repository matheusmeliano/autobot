import { redirect } from "next/navigation";

export const permanent = true;

export default function AdminUsuariosLegacyRedirect() {
  redirect("/app/admin");
}
