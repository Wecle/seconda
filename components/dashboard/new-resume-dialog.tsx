"use client";

import type { ChangeEvent, DragEvent, RefObject } from "react";
import { Sparkles, Upload } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GeneratedResumeForm } from "@/components/dashboard/generated-resume-form";
import { UploadResumeForm } from "@/components/dashboard/upload-resume-form";
import { useTranslation } from "@/lib/i18n/context";
import type { GeneratedResumeDraft } from "@/lib/resume/generation-contract";
import { cn } from "@/lib/utils";

export type NewResumeMode = "upload" | "generate";

interface NewResumeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: NewResumeMode;
  onModeChange: (mode: NewResumeMode) => void;
  uploadTitle: string;
  onUploadTitleChange: (title: string) => void;
  dragOver: boolean;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFileSelect: (event: ChangeEvent<HTMLInputElement>) => void;
  selectedFile: File | null;
  onClearFile: () => void;
  uploadError: string | null;
  uploading: boolean;
  onUpload: () => void;
  generatedDraft: GeneratedResumeDraft;
  onGeneratedDraftChange: (draft: GeneratedResumeDraft) => void;
  generating: boolean;
  generateError: string | null;
  onGenerate: () => void;
}

export function NewResumeDialog({
  open,
  onOpenChange,
  mode,
  onModeChange,
  uploadTitle,
  onUploadTitleChange,
  dragOver,
  onDragOver,
  onDragLeave,
  onDrop,
  fileInputRef,
  onFileSelect,
  selectedFile,
  onClearFile,
  uploadError,
  uploading,
  onUpload,
  generatedDraft,
  onGeneratedDraftChange,
  generating,
  generateError,
  onGenerate,
}: NewResumeDialogProps) {
  const { t } = useTranslation();
  const contentClassName = cn(
    "overflow-hidden p-0 [interpolate-size:allow-keywords]",
    "transition-[width,max-width,height] duration-300 ease-out motion-reduce:transition-none",
    mode === "generate"
      ? "h-[90vh] sm:max-w-5xl"
      : "h-auto sm:max-w-md",
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={contentClassName}
        onEscapeKeyDown={(event) => {
          if (uploading || generating) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (uploading || generating) event.preventDefault();
        }}
      >
        <Tabs
          value={mode}
          onValueChange={(value) => onModeChange(value as NewResumeMode)}
          className="min-h-0 gap-0"
        >
          <div className="shrink-0 border-b px-6 pt-6">
            <DialogHeader className="pr-8">
              <DialogTitle>{t.dashboard.newResumeTitle}</DialogTitle>
              <DialogDescription>{t.dashboard.newResumeDescription}</DialogDescription>
            </DialogHeader>
            <TabsList className="mt-5 grid w-full grid-cols-2">
              <TabsTrigger value="upload" disabled={uploading || generating}>
                <Upload className="size-4" />
                {t.dashboard.uploadTab}
              </TabsTrigger>
              <TabsTrigger value="generate" disabled={uploading || generating}>
                <Sparkles className="size-4" />
                {t.dashboard.generateTab}
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent
            value="upload"
            forceMount
            className="p-6 data-[state=inactive]:hidden"
          >
            <UploadResumeForm
              uploadTitle={uploadTitle}
              onUploadTitleChange={onUploadTitleChange}
              dragOver={dragOver}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              fileInputRef={fileInputRef}
              onFileSelect={onFileSelect}
              selectedFile={selectedFile}
              onClearFile={onClearFile}
              uploadError={uploadError}
              uploading={uploading}
              onCancel={() => onOpenChange(false)}
              onUpload={onUpload}
            />
          </TabsContent>

          <TabsContent
            value="generate"
            forceMount
            className={cn(
              "min-h-0 flex-1 data-[state=inactive]:hidden",
              "transition-opacity duration-150 data-[state=active]:delay-150 data-[state=active]:opacity-100 motion-reduce:transition-none motion-reduce:data-[state=active]:delay-0",
              mode === "generate" ? "opacity-100" : "opacity-0",
            )}
          >
            <GeneratedResumeForm
              draft={generatedDraft}
              onDraftChange={onGeneratedDraftChange}
              generating={generating}
              generateError={generateError}
              onCancel={() => onOpenChange(false)}
              onGenerate={onGenerate}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
