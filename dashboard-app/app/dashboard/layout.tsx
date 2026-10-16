import { requireActiveUser } from "@/lib/authz";
import { redirect } from "next/navigation";
import { DashboardSidebar } from "@/components/dashboard/sidebar";
import { MobileNav } from "@/components/dashboard/mobile-nav";
import { Toaster } from "@/components/ui/toaster";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let context;

  try {
    context = await requireActiveUser();
  } catch {
    redirect("/auth/login?error=account_inactive");
  }

  const isAdmin = context.authorization.role === "admin";

  return (
    <div className="min-h-screen flex bg-background">
      <DashboardSidebar isAdmin={isAdmin} />
      <main className="flex-1 min-w-0">
        <MobileNav userEmail={context.user.email} brand="bitXbit" />
        {children}
      </main>
      <Toaster />
    </div>
  );
}
