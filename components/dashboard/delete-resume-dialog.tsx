"use client";

import { Loader2 } from "lucide-react";
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
  return (
    <AlertDialog open={Boolean(pendingDeleteResume)} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Resume?</AlertDialogTitle>
          <AlertDialogDescription>
            {pendingDeleteResume
              ? `Are you sure you want to delete "${pendingDeleteResume.title}"? This will also delete its versions and related interviews. This action cannot be undone.`
              : "This action cannot be undone."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={Boolean(deletingResumeId)}>
            Cancel
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
                Deleting...
              </>
            ) : (
              "Delete"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
