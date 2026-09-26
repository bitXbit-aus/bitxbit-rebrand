"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  User,
  Gift,
  Activity,
  Wallet,
  FileText,
  LogOut,
  Shield,
  Store,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

const memberLinks = [
  { name: "Overview", href: "/dashboard", icon: LayoutDashboard },
  { name: "Offers", href: "/dashboard/offers", icon: Store },
  { name: "Rewards", href: "/dashboard/rewards", icon: Gift },
  { name: "Activity", href: "/dashboard/activity", icon: Activity },
  { name: "Wallet", href: "/dashboard/wallet", icon: Wallet },
  { name: "Profile", href: "/dashboard/profile", icon: User },
  { name: "Transparency", href: "/dashboard/transparency", icon: FileText },
];

const adminLinks = [
  { name: "Admin Overview", href: "/admin", icon: Shield },
];

export function DashboardSidebar({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/auth/login");
  };

  return (
    <aside className="hidden lg:flex flex-col w-64 border-r border-border bg-card min-h-screen sticky top-0">
      <div className="p-6">
        <Link href="/dashboard" className="flex items-center">
          <span className="font-bold text-lg text-white">bitXbit</span>
        </Link>
      </div>

      <nav className="flex-1 px-3 space-y-1">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-3 mb-2">
          Member
        </div>
        {memberLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              "flex items-center space-x-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
              pathname === link.href
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <link.icon className="h-4 w-4" />
            <span>{link.name}</span>
          </Link>
        ))}

        {isAdmin && (
          <>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-3 mb-2 mt-6">
              Admin
            </div>
            {adminLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "flex items-center space-x-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                  pathname === link.href
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <link.icon className="h-4 w-4" />
                <span>{link.name}</span>
              </Link>
            ))}
          </>
        )}
      </nav>

      <div className="p-3 mt-auto border-t border-border">
        <button
          onClick={handleLogout}
          className="flex items-center space-x-3 px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors w-full"
        >
          <LogOut className="h-4 w-4" />
          <span>Sign Out</span>
        </button>
      </div>
    </aside>
  );
}
