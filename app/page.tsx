import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

export default async function IndexPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  } else {
    redirect("/home");
  }
}
