"use client";

import type { ChangeEvent, DragEvent, RefObject } from "react";
import { AlertCircle, CheckCircle2, FileText, Loader2, Upload, X } from "lucide-react";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface UploadResumeFormProps {
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
  onCancel: () => void;
  onUpload: () => void;
}

export function UploadResumeForm({
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
  onCancel,
  onUpload,
}: UploadResumeFormProps) {
  const { t } = useTranslation();

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        if (selectedFile && !uploading) {
          onUpload();
        }
      }}
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="upload-resume-title" className="text-xs font-semibold">
            {t.dashboard.resumeTitle}
          </Label>
          <Input
            id="upload-resume-title"
            value={uploadTitle}
            onChange={(event) => onUploadTitleChange(event.target.value)}
            placeholder={t.dashboard.resumeTitlePlaceholder}
            className="text-xs"
          />
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
          onChange={onFileSelect}
          className="hidden"
          disabled={uploading}
        />

        {selectedFile ? (
          <div
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            className={cn(
              "rounded-xl border bg-card p-4 transition-all duration-150 shadow-xs",
              dragOver
                ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                : "border-border/80 hover:border-border",
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <FileText className="size-5" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-foreground">
                    {selectedFile.name}
                  </p>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                    <span className="font-mono">
                      {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                    </span>
                    <span>·</span>
                    <span className="inline-flex items-center gap-1 text-emerald-600 font-medium">
                      <CheckCircle2 className="size-3" />
                      PDF
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  className="h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                >
                  {t.dashboard.reselectFile}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="size-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  onClick={onClearFile}
                  disabled={uploading}
                  aria-label={t.dashboard.clearSelectedFile}
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "group flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-7 text-center transition-all duration-150",
              dragOver
                ? "border-primary bg-primary/8 scale-[0.99] shadow-inner"
                : "border-border/80 bg-muted/20 hover:border-primary/50 hover:bg-muted/40",
            )}
          >
            <div className="mx-auto mb-2.5 flex size-11 items-center justify-center rounded-xl bg-muted/80 text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
              <Upload className="size-5" />
            </div>
            <p className="text-xs font-semibold text-foreground">
              {t.dashboard.dropPdf}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {t.dashboard.pdfLimit}
            </p>
          </div>
        )}

        {uploadError ? (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-xl bg-destructive/10 p-3 text-xs text-destructive"
          >
            <AlertCircle className="size-4 shrink-0" />
            <span>{uploadError}</span>
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center justify-end gap-2 border-t bg-background px-6 py-4">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={uploading}
        >
          {t.common.cancel}
        </Button>
        <Button
          type="submit"
          disabled={!selectedFile || uploading}
          className="gap-1.5 font-medium shadow-xs"
        >
          {uploading ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              {t.common.processing}
            </>
          ) : (
            <>
              <Upload className="size-3.5" />
              {t.dashboard.uploadAndParse}
            </>
          )}
        </Button>
      </div>
    </form>
  );
}

