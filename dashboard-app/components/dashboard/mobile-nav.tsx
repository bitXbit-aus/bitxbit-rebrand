"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { LogOut, Menu } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { createClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"
import { adminLinks, memberLinks } from "./nav-links"

interface MobileNavProps {
  isAdmin?: boolean
  userEmail?: string | null
  brand?: string
}

export function MobileNav({
  isAdmin = false,
  userEmail,
  brand = "bitXbit",
}: MobileNavProps) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  const isActive = (href: string) =>
    href === "/dashboard" || href === "/admin"
      ? pathname === href
      : pathname.startsWith(href)

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push("/auth/login")
  }

  return (
    <div className="lg:hidden flex items-center justify-between h-16 px-4 border-b border-border w-full relative z-50">
      <Link
        href={isAdmin ? "/admin" : "/dashboard"}
        className="font-bold text-lg text-white"
      >
        {brand}
      </Link>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon">
            <Menu className="h-5 w-5" />
            <span className="sr-only">Open menu</span>
          </Button>
        </SheetTrigger>
        <SheetContent
          side="right"
          className="w-[280px] sm:w-[320px] p-0 flex flex-col"
        >
          <SheetTitle className="sr-only">Navigation menu</SheetTitle>

          <div className="p-6 border-b border-border">
            <div className="font-bold text-lg text-white">{brand}</div>
            {userEmail && (
              <div className="text-xs text-muted-foreground mt-1 truncate">
                {userEmail}
              </div>
            )}
          </div>

          <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-3 mb-2">
              Member
            </div>
            {memberLinks.map((link) => (
              <SheetClose asChild key={link.href}>
                <Link
                  href={link.href}
                  className={cn(
                    "flex items-center space-x-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                    isActive(link.href)
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <link.icon className="h-4 w-4" />
                  <span>{link.name}</span>
                </Link>
              </SheetClose>
            ))}

            {isAdmin && (
              <>
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-3 mb-2 mt-6">
                  Admin
                </div>
                {adminLinks.map((link) => (
                  <SheetClose asChild key={link.href}>
                    <Link
                      href={link.href}
                      className={cn(
                        "flex items-center space-x-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                        isActive(link.href)
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}
                    >
                      <link.icon className="h-4 w-4" />
                      <span>{link.name}</span>
                    </Link>
                  </SheetClose>
                ))}
              </>
            )}
          </nav>

          <div className="p-3 border-t border-border">
            <button
              onClick={handleLogout}
              className="flex items-center space-x-3 px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors w-full"
            >
              <LogOut className="h-4 w-4" />
              <span>Sign Out</span>
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
