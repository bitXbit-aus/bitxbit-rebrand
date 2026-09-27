"use client"

import { Button } from "@/components/ui/button"
import { Download } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"
import { formatCurrency, formatDate } from "@/lib/utils"

interface RewardExportItem {
  id: string
  estimated_aud_value: number | null
  bitxbit_amount: number | null
  status: string
  distribution_tx_hash: string | null
  distributed_at: string | null
  created_at: string
  period?: { start_date: string; end_date: string } | null
}

interface RewardsExportButtonProps {
  rewards: RewardExportItem[]
}

export function RewardsExportButton({ rewards }: RewardsExportButtonProps) {
  const { toast } = useToast()

  const handleExport = () => {
    try {
      const rows = [
        [
          "Period",
          "Estimated (AUD)",
          "bitxbit Amount",
          "Status",
          "Tx Hash",
          "Distributed At",
          "Created At",
        ],
        ...rewards.map((r) => [
          r.period
            ? `${formatDate(r.period.start_date)} – ${formatDate(r.period.end_date)}`
            : "—",
          String(r.estimated_aud_value ?? ""),
          r.bitxbit_amount ? r.bitxbit_amount.toFixed(4) : "",
          r.status,
          r.distribution_tx_hash ?? "",
          r.distributed_at ? formatDate(r.distributed_at) : "",
          formatDate(r.created_at),
        ]),
      ]

      const csv = rows
        .map((row) =>
          row
            .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
            .join(",")
        )
        .join("\n")

      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `bitxbit-rewards-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)

      toast({
        title: "Exported",
        description: `${rewards.length} reward record${rewards.length === 1 ? "" : "s"} downloaded.`,
      })
    } catch {
      toast({
        title: "Export failed",
        description: "Could not generate CSV.",
        variant: "destructive",
      })
    }
  }

  if (rewards.length === 0) return null

  return (
    <Button variant="outline" size="sm" onClick={handleExport}>
      <Download className="h-4 w-4 mr-2" />
      Export CSV
    </Button>
  )
}
