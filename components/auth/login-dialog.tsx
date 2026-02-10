"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Github, Loader2 } from "lucide-react";
import { useTranslation } from "@/lib/i18n/context";
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
  const { t } = useTranslation();
  const [mode, setMode] = useState<AuthMode>("signIn");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [providerLoading, setProviderLoading] = useState<ProviderName | null>(
    null,
  );

  const modeTitle = mode === "signIn" ? t.auth.emailLogin : t.auth.emailSignUp;
  const submitLabel = mode === "signIn" ? t.common.login : t.auth.signUpAndLogin;

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
      setError(t.auth.oauthError);
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
            ? t.auth.signInError
            : t.auth.signUpError,
        );
        return;
      }

      const target = result.url ?? callbackUrl;
      onOpenChange(false);
      router.push(target);
      router.refresh();
    } catch {
      setError(t.auth.requestError);
    } finally {
      setSubmitting(false);
    }
  };

  const isBusy = submitting || providerLoading !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t.auth.loginTitle}</DialogTitle>
          <DialogDescription>
            {t.auth.loginDescription}
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
            {t.common.login}
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
            {t.common.signUp}
          </Button>
        </div>

        <form className="space-y-3" onSubmit={handleCredentialsSubmit}>
          <p className="text-sm font-medium text-foreground">{modeTitle}</p>

          {mode === "signUp" && (
            <div className="space-y-1.5">
              <Label htmlFor="auth-name">{t.auth.nickname}</Label>
              <Input
                id="auth-name"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  resetError();
                }}
                placeholder={t.auth.nicknamePlaceholder}
                maxLength={80}
                disabled={isBusy}
                required
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="auth-email">{t.auth.email}</Label>
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
            <Label htmlFor="auth-password">{t.auth.password}</Label>
            <Input
              id="auth-password"
              type="password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                resetError();
              }}
              placeholder={t.auth.passwordPlaceholder}
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
            <span className="bg-background px-2 text-muted-foreground">{t.auth.orThirdParty}</span>
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
