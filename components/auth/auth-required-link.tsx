"use client";

import { useState } from "react";
import Link from "next/link";
import { LoginDialog } from "@/components/auth/login-dialog";

type AuthRequiredLinkProps = {
  isAuthenticated: boolean;
  href: string;
  className?: string;
  children: React.ReactNode;
};

export function AuthRequiredLink({
  isAuthenticated,
  href,
  className,
  children,
}: AuthRequiredLinkProps) {
  const [open, setOpen] = useState(false);

  if (isAuthenticated) {
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    );
  }

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {children}
      </button>
      <LoginDialog open={open} onOpenChange={setOpen} callbackUrl={href} />
    </>
  );
}
