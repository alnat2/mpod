import logoMark from "@/assets/logo-mark.svg";
import { cn } from "@/lib/utils";

type LogoProps = {
  className?: string;
};

export function Logo({ className }: LogoProps) {
  return (
    <div
      className={cn("flex shrink-0 items-center gap-2 overflow-hidden p-1", className)}
      aria-label="mpod"
    >
      <img className="h-8 w-10 shrink-0" src={logoMark} alt="" />
      <span className="font-['Rajdhani'] text-[28px] leading-none font-bold text-foreground">
        mpod
      </span>
    </div>
  );
}
