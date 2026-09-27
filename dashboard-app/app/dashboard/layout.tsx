import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { DashboardSidebar } from "@/components/dashboard/sidebar";
import { MobileNav } from "@/components/dashboard/mobile-nav";
import { Toaster } from "@/components/ui/toaster";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  const { data: dbUser } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  const isAdmin = dbUser?.role === "admin";

  return (
    <div className="min-h-screen flex bg-background">
      <DashboardSidebar isAdmin={isAdmin} />
      <main className="flex-1 min-w-0">
        <MobileNav isAdmin={isAdmin} userEmail={user?.email} brand="bitXbit" />
        {children}
      </main>
      <Toaster />
    </div>
  );
}
