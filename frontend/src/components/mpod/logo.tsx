import logo from "@/assets/logo.svg";
import { cn } from "@/lib/utils";

type LogoProps = {
  className?: string;
};

export function Logo({ className }: LogoProps) {
  return (
    <img
      className={cn("h-11 w-[123px] shrink-0 overflow-hidden p-1", className)}
      src={logo}
      alt="mpod"
    />
  );
}
