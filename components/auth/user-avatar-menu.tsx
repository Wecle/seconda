"use client";

import { useMemo, useState } from "react";
import { Loader2, LogOut } from "lucide-react";
import { signOut } from "next-auth/react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";

export type UserAvatarMenuUser = {
  name?: string | null;
  email?: string | null;
  image?: string | null;
};

interface UserAvatarMenuProps {
  user: UserAvatarMenuUser;
  className?: string;
  avatarSize?: "sm" | "default" | "lg";
  panelAlign?: "center" | "left" | "right";
  callbackUrl?: string;
}

function getUserInitials(user: UserAvatarMenuUser) {
  const source = user.name?.trim() || user.email?.trim() || "U";
  const plain = source.includes("@") ? source.split("@")[0] : source;
  const cleaned = plain.replace(/[^a-zA-Z0-9\u4e00-\u9fff ]/g, " ").trim();
  const segments = cleaned.split(/\s+/).filter(Boolean);
  if (segments.length >= 2) {
    return `${segments[0][0]}${segments[1][0]}`.toUpperCase();
  }
  return cleaned.slice(0, 2).toUpperCase() || "U";
}

export function UserAvatarMenu({
  user,
  className,
  avatarSize = "default",
  panelAlign = "center",
  callbackUrl = "/",
}: UserAvatarMenuProps) {
  const [signingOut, setSigningOut] = useState(false);

  const displayName =
    user.name?.trim() || user.email?.split("@")[0] || "Seconda 用户";
  const initials = useMemo(() => getUserInitials(user), [user]);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut({ callbackUrl });
    } finally {
      setSigningOut(false);
    }
  };

  const align =
    panelAlign === "left" ? "start" : panelAlign === "center" ? "center" : "end";

  return (
    <div className={cn("relative flex items-center", className)}>
      <HoverCard openDelay={100} closeDelay={100}>
        <HoverCardTrigger asChild>
          <button
            type="button"
            aria-haspopup="true"
            aria-label={`${displayName} 账号菜单`}
            className="rounded-full outline-none ring-offset-background transition-shadow focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Avatar size={avatarSize}>
              {user.image ? (
                <AvatarImage src={user.image} alt={displayName} />
              ) : null}
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
          </button>
        </HoverCardTrigger>

        <HoverCardContent align={align} sideOffset={10} className="w-64 p-3">
          <p className="text-xs text-muted-foreground">当前账号</p>
          <p className="mt-1 truncate text-sm font-medium">{displayName}</p>
          {user.email ? (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {user.email}
            </p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3 w-full"
            onClick={() => void handleSignOut()}
            disabled={signingOut}
          >
            {signingOut ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <LogOut className="size-4" />
            )}
            退出登录
          </Button>
        </HoverCardContent>
      </HoverCard>
    </div>
  );
}
