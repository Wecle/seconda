"use client";

import { useTranslation } from "@/lib/i18n/context";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface ErrorAlertDialogProps {
  message: string | null;
  onOpenChange: (open: boolean) => void;
}

export function ErrorAlertDialog({
  message,
  onOpenChange,
}: ErrorAlertDialogProps) {
  const { t } = useTranslation();
  return (
    <AlertDialog open={Boolean(message)} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t.dashboard.actionFailed}</AlertDialogTitle>
          <AlertDialogDescription>
            {message ?? t.dashboard.pleaseTryAgain}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction>{t.common.ok}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
