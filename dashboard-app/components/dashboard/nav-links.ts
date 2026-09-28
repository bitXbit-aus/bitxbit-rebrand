import {
  LayoutDashboard,
  User,
  Gift,
  Activity,
  Wallet,
  FileText,
  Shield,
  Store,
  Tags,
  Coins,
  TrendingUp,
  Briefcase,
  PieChart,
  Megaphone,
  Users,
  BarChart3,
} from "lucide-react";

export const memberLinks = [
  { name: "Overview", href: "/dashboard", icon: LayoutDashboard },
  { name: "Offers", href: "/dashboard/offers", icon: Store },
  { name: "Rewards", href: "/dashboard/rewards", icon: Gift },
  { name: "Referrals", href: "/dashboard/referrals", icon: Users },
  { name: "Activity", href: "/dashboard/activity", icon: Activity },
  { name: "Wallet", href: "/dashboard/wallet", icon: Wallet },
  { name: "Profile", href: "/dashboard/profile", icon: User },
  { name: "Transparency", href: "/dashboard/transparency", icon: FileText },
];

export const adminLinks = [
  { name: "Overview", href: "/admin", icon: Shield },
  { name: "Offers", href: "/admin/offers", icon: Megaphone },
  { name: "Categories", href: "/admin/categories", icon: Tags },
  { name: "Income", href: "/admin/income", icon: TrendingUp },
  { name: "Projects", href: "/admin/projects", icon: Briefcase },
  { name: "Allocations", href: "/admin/allocations", icon: PieChart },
  { name: "Users", href: "/admin/users", icon: Users },
  { name: "Referrals", href: "/admin/referrals", icon: TrendingUp },
  { name: "Rewards", href: "/admin/rewards", icon: Coins },
  { name: "Analytics", href: "/admin/analytics", icon: BarChart3 },
];
