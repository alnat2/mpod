import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  AlertTriangle as AlertTriangleIcon,
  CancelCircleIcon,
  CheckmarkCircleIcon,
  InformationCircleIcon,
  Loading03Icon,
} from "@hugeicons/core-free-icons"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: (
          <HugeiconsIcon icon={CheckmarkCircleIcon} size={16} />
        ),
        info: (
          <HugeiconsIcon icon={InformationCircleIcon} size={16} />
        ),
        warning: (
          <HugeiconsIcon icon={AlertTriangleIcon} size={16} />
        ),
        error: (
          <HugeiconsIcon icon={CancelCircleIcon} size={16} />
        ),
        loading: (
          <HugeiconsIcon icon={Loading03Icon} size={16} className="animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
