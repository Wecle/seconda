"use client";

import { useState } from "react";
import Link from "next/link";
import { type VariantProps } from "class-variance-authority";
import { Button, buttonVariants } from "@/components/ui/button";
import { LoginDialog } from "@/components/auth/login-dialog";

type ButtonVariant = VariantProps<typeof buttonVariants>["variant"];
type ButtonSize = VariantProps<typeof buttonVariants>["size"];

type StartInterviewButtonProps = {
  isAuthenticated: boolean;
  href?: string;
  children: React.ReactNode;
  className?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function StartInterviewButton({
  isAuthenticated,
  href = "/dashboard",
  children,
  className,
  variant,
  size,
}: StartInterviewButtonProps) {
  const [open, setOpen] = useState(false);

  if (isAuthenticated) {
    return (
      <Button asChild className={className} variant={variant} size={size}>
        <Link href={href}>{children}</Link>
      </Button>
    );
  }

  return (
    <>
      <Button
        type="button"
        className={className}
        variant={variant}
        size={size}
        onClick={() => setOpen(true)}
      >
        {children}
      </Button>
      <LoginDialog open={open} onOpenChange={setOpen} callbackUrl={href} />
    </>
  );
}
