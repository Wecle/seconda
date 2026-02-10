"use client";

import { Loader2 } from "lucide-react";
import { useTranslation } from "@/lib/i18n/context";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface DeleteResumeDialogProps {
  pendingDeleteResume: { id: string; title: string } | null;
  deletingResumeId: string | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (resumeId: string) => void;
}

export function DeleteResumeDialog({
  pendingDeleteResume,
  deletingResumeId,
  onOpenChange,
  onConfirm,
}: DeleteResumeDialogProps) {
  const { t } = useTranslation();
  return (
    <AlertDialog open={Boolean(pendingDeleteResume)} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t.dashboard.deleteResume}</AlertDialogTitle>
          <AlertDialogDescription>
            {pendingDeleteResume
              ? t.dashboard.deleteResumeConfirm.replace("{title}", pendingDeleteResume.title)
              : t.dashboard.deleteResumeGeneric}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={Boolean(deletingResumeId)}>
            {t.common.cancel}
          </AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20"
            disabled={
              !pendingDeleteResume || deletingResumeId === pendingDeleteResume.id
            }
            onClick={(event) => {
              event.preventDefault();
              if (!pendingDeleteResume) return;
              onConfirm(pendingDeleteResume.id);
            }}
          >
            {pendingDeleteResume &&
            deletingResumeId === pendingDeleteResume.id ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {t.common.deleting}
              </>
            ) : (
              t.common.delete
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
