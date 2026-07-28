"use client";

import type { ChangeEvent, DragEvent, RefObject } from "react";
import { AlertCircle, FileText, Loader2, Upload, X } from "lucide-react";
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
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="upload-resume-title">{t.dashboard.resumeTitle}</Label>
        <Input
          id="upload-resume-title"
          value={uploadTitle}
          onChange={(event) => onUploadTitleChange(event.target.value)}
          placeholder={t.dashboard.resumeTitlePlaceholder}
        />
      </div>

      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors",
          dragOver
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/25 hover:border-primary/50",
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
          onChange={onFileSelect}
          className="hidden"
        />
        {selectedFile ? (
          <div className="flex items-center gap-3">
            <FileText className="size-8 text-primary" />
            <div>
              <p className="text-sm font-medium">{selectedFile.name}</p>
              <p className="text-xs text-muted-foreground">
                {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={(event) => {
                event.stopPropagation();
                onClearFile();
              }}
              aria-label={t.dashboard.clearSelectedFile}
            >
              <X className="size-4" />
            </Button>
          </div>
        ) : (
          <>
            <Upload className="size-8 text-muted-foreground/50" />
            <p className="mt-2 text-sm font-medium">{t.dashboard.dropPdf}</p>
            <p className="text-xs text-muted-foreground">{t.dashboard.pdfLimit}</p>
          </>
        )}
      </div>

      {uploadError ? (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive"
        >
          <AlertCircle className="size-4 shrink-0" />
          {uploadError}
        </div>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={uploading}>
          {t.common.cancel}
        </Button>
        <Button type="button" onClick={onUpload} disabled={!selectedFile || uploading}>
          {uploading ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              {t.common.processing}
            </>
          ) : (
            <>
              <Upload className="size-4" />
              {t.dashboard.uploadAndParse}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
