"use client"

import { useState } from "react"
import { toast } from "@/components/ui/use-toast"
import { cn } from "@/lib/utils"
import { actionError } from "@/lib/action-result"

interface FormWithToastProps
  extends Omit<React.FormHTMLAttributes<HTMLFormElement>, "action"> {
  action: (formData: FormData) => Promise<unknown>
  successMessage?: string
  errorMessage?: string
  children: React.ReactNode
}

export function FormWithToast({
  action,
  successMessage = "Saved successfully",
  errorMessage = "Something went wrong",
  children,
  className,
  ...props
}: FormWithToastProps) {
  const [isPending, setIsPending] = useState(false)

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setIsPending(true)

    const formData = new FormData(event.currentTarget)

    try {
      const result = await action(formData)
      const refusal = actionError(result)
      if (refusal) {
        toast({ title: "Error", description: refusal, variant: "destructive" })
      } else {
        toast({ title: "Success", description: successMessage })
      }
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : errorMessage,
        variant: "destructive",
      })
    } finally {
      setIsPending(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      data-pending={isPending || undefined}
      className={cn(
        "transition-opacity",
        isPending && "opacity-70 pointer-events-none",
        className
      )}
      {...props}
    >
      {children}
    </form>
  )
}
