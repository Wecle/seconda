"use client";

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
  return (
    <AlertDialog open={Boolean(message)} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Action failed</AlertDialogTitle>
          <AlertDialogDescription>
            {message ?? "Please try again."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction>OK</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
