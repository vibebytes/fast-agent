import { Loader2Icon, type LucideProps } from "lucide-react"

import { cn } from "@fast-ide/ui/lib/utils"

function Spinner({ className, ...props }: LucideProps) {
  return (
    <Loader2Icon
      role="status"
      aria-label="Loading"
      className={cn("size-4 animate-spin [will-change:transform]", className)}
      {...props}
    />
  )
}

export { Spinner }
