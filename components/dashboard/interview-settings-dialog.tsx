"use client";

import { Loader2 } from "lucide-react";
import { InterviewSettingsForm } from "@/components/interview/interview-settings-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { InterviewConfig } from "@/lib/interview/settings";

interface InterviewSettingsDialogProps {
  open: boolean;
  saving: boolean;
  value: InterviewConfig;
  onOpenChange: (open: boolean) => void;
  onChange: (value: InterviewConfig) => void;
  onCancel: () => void;
  onSave: () => void;
}

export function InterviewSettingsDialog({
  open,
  saving,
  value,
  onOpenChange,
  onChange,
  onCancel,
  onSave,
}: InterviewSettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[680px]">
        <DialogHeader className="border-b px-6 py-5 text-left">
          <DialogTitle>Interview Settings</DialogTitle>
          <DialogDescription>
            Configure your AI mock interview session parameters.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          <InterviewSettingsForm value={value} onChange={onChange} />
        </div>
        <div className="flex items-center justify-end gap-3 border-t px-6 py-4">
          <Button variant="ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button
            className="bg-primary text-primary-foreground"
            onClick={onSave}
            disabled={saving}
          >
            {saving ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Saving...
              </>
            ) : (
              "Save"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
