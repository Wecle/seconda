"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Github, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type AuthMode = "signIn" | "signUp";

type ProviderName = "github" | "google";

type LoginDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  callbackUrl?: string;
};

export function LoginDialog({
  open,
  onOpenChange,
  callbackUrl = "/dashboard",
}: LoginDialogProps) {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("signIn");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [providerLoading, setProviderLoading] = useState<ProviderName | null>(
    null,
  );

  const modeTitle = mode === "signIn" ? "邮箱登录" : "邮箱注册";
  const submitLabel = mode === "signIn" ? "登录" : "注册并登录";

  const resetError = () => {
    if (error) {
      setError(null);
    }
  };

  const handleOAuthSignIn = async (provider: ProviderName) => {
    try {
      setProviderLoading(provider);
      setError(null);
      await signIn(provider, { callbackUrl });
    } catch {
      setError("第三方登录失败，请稍后重试。");
      setProviderLoading(null);
    }
  };

  const handleCredentialsSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const result = await signIn("credentials", {
        redirect: false,
        mode,
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password,
        callbackUrl,
      });

      if (!result || result.error) {
        setError(
          mode === "signIn"
            ? "邮箱或密码错误。"
            : "注册失败，邮箱可能已被使用。",
        );
        return;
      }

      const target = result.url ?? callbackUrl;
      onOpenChange(false);
      router.push(target);
      router.refresh();
    } catch {
      setError("请求失败，请稍后重试。");
    } finally {
      setSubmitting(false);
    }
  };

  const isBusy = submitting || providerLoading !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>登录 Seconda</DialogTitle>
          <DialogDescription>
            使用邮箱、GitHub 或 Google 登录，简历与面试记录会自动绑定到账号。
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant={mode === "signIn" ? "default" : "outline"}
            onClick={() => {
              setMode("signIn");
              resetError();
            }}
            disabled={isBusy}
          >
            登录
          </Button>
          <Button
            type="button"
            variant={mode === "signUp" ? "default" : "outline"}
            onClick={() => {
              setMode("signUp");
              resetError();
            }}
            disabled={isBusy}
          >
            注册
          </Button>
        </div>

        <form className="space-y-3" onSubmit={handleCredentialsSubmit}>
          <p className="text-sm font-medium text-foreground">{modeTitle}</p>

          {mode === "signUp" && (
            <div className="space-y-1.5">
              <Label htmlFor="auth-name">昵称</Label>
              <Input
                id="auth-name"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  resetError();
                }}
                placeholder="你的名字"
                maxLength={80}
                disabled={isBusy}
                required
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="auth-email">邮箱</Label>
            <Input
              id="auth-email"
              type="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                resetError();
              }}
              placeholder="you@example.com"
              autoComplete="email"
              disabled={isBusy}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="auth-password">密码</Label>
            <Input
              id="auth-password"
              type="password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                resetError();
              }}
              placeholder="至少 8 位"
              autoComplete={mode === "signIn" ? "current-password" : "new-password"}
              minLength={8}
              maxLength={128}
              disabled={isBusy}
              required
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" className="w-full" disabled={isBusy}>
            {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
            {submitLabel}
          </Button>
        </form>

        <div className="relative my-1">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-background px-2 text-muted-foreground">或使用第三方账号</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => void handleOAuthSignIn("github")}
            disabled={isBusy}
            className="w-full"
          >
            {providerLoading === "github" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Github className="size-4" />
            )}
            GitHub
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={() => void handleOAuthSignIn("google")}
            disabled={isBusy}
            className="w-full"
          >
            {providerLoading === "google" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <span className="text-sm font-semibold">G</span>
            )}
            Google
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
