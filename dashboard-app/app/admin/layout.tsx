import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { DashboardSidebar } from "@/components/dashboard/sidebar";
import { Toaster } from "@/components/ui/toaster";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const { data: dbUser } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (dbUser?.role !== "admin") redirect("/dashboard");

  return (
    <div className="min-h-screen flex bg-background">
      <DashboardSidebar isAdmin />
      <main className="flex-1 min-w-0">
        <div className="lg:hidden h-16 border-b border-border flex items-center px-4">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-sm">Bx</span>
            </div>
            <span className="font-bold text-lg text-white">bitXbit Admin</span>
          </div>
        </div>
        {children}
      </main>
      <Toaster />
    </div>
  );
}
