"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { LogOut, Menu, X } from "lucide-react"
import { Button } from "@/components/ui/button"
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
    setOpen(false)
    await supabase.auth.signOut()
    router.push("/auth/login")
  }

  const close = () => setOpen(false)

  const links = (
    <>
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-3 mb-2">
        Member
      </div>
      {memberLinks.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          onClick={close}
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
              onClick={close}
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
          ))}
        </>
      )}
    </>
  )

  return (
    <>
      <div className="lg:hidden flex items-center justify-between h-16 px-4 border-b border-border w-full relative z-50 bg-background">
        <Link
          href={isAdmin ? "/admin" : "/dashboard"}
          className="font-bold text-lg text-white"
        >
          {brand}
        </Link>

        <Button
          variant="ghost"
          size="icon"
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </Button>
      </div>

      {/* Overlay */}
      {open && (
        <div
          className="fixed inset-0 bg-black/80 z-[60] lg:hidden"
          onClick={close}
          aria-hidden="true"
        />
      )}

      {/* Slide-out panel */}
      <div
        className={cn(
          "fixed top-0 right-0 h-full w-[280px] sm:w-[320px] bg-background border-l border-border z-[70] flex flex-col transition-transform duration-300 ease-in-out lg:hidden",
          open ? "translate-x-0" : "translate-x-full"
        )}
        aria-hidden={!open}
      >
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div>
            <div className="font-bold text-lg text-white">{brand}</div>
            {userEmail && (
              <div className="text-xs text-muted-foreground mt-1 truncate max-w-[200px]">
                {userEmail}
              </div>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            type="button"
            onClick={close}
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {links}
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
      </div>
    </>
  )
}
