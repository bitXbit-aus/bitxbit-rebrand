import { requireActiveAdmin, AuthorizationError } from "@/lib/authz";
import { redirect } from "next/navigation";
import { DashboardSidebar } from "@/components/dashboard/sidebar";
import { MobileNav } from "@/components/dashboard/mobile-nav";
import { Toaster } from "@/components/ui/toaster";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  let context;

  try {
    context = await requireActiveAdmin();
  } catch (error) {
    if (error instanceof AuthorizationError && error.code === "ADMIN_REQUIRED") {
      redirect("/dashboard");
    }
    redirect("/auth/login?error=account_inactive");
  }

  return (
    <div className="min-h-screen flex bg-background">
      <DashboardSidebar isAdmin />
      <main className="flex-1 min-w-0">
        <MobileNav isAdmin userEmail={context.user.email} brand="bitXbit Admin" />
        {children}
      </main>
      <Toaster />
    </div>
  );
}
