import Image from "next/image";
import { cn } from "@/lib/utils";

interface BrandIconProps {
  size?: number;
  className?: string;
  priority?: boolean;
}

export function BrandIcon({
  size = 28,
  className,
  priority = false,
}: BrandIconProps) {
  return (
    <Image
      src="/logo.png"
      alt="Seconda logo"
      width={size}
      height={size}
      priority={priority}
      className={cn("shrink-0", className)}
    />
  );
}
