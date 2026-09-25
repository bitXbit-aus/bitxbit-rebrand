import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number | null | undefined): string {
  if (amount == null) return "$0.00"
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
  }).format(amount)
}

export function formatNumber(num: number | null | undefined): string {
  if (num == null) return "0"
  return new Intl.NumberFormat("en-AU").format(num)
}

export function truncateAddress(address: string | null | undefined): string {
  if (!address) return "Not connected"
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

export function formatDate(date: string | null | undefined): string {
  if (!date) return "—"
  return new Date(date).toLocaleDateString("en-AU", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}
