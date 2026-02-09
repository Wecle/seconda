"use client";

import type { ChangeEvent, DragEvent, RefObject } from "react";
import { AlertCircle, FileText, Loader2, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";
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

interface UploadResumeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  uploadTitle: string;
  onUploadTitleChange: (title: string) => void;
  dragOver: boolean;
  onDragOver: (e: DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onDrop: (e: DragEvent<HTMLDivElement>) => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFileSelect: (e: ChangeEvent<HTMLInputElement>) => void;
  selectedFile: File | null;
  onClearFile: () => void;
  uploadError: string | null;
  uploading: boolean;
  onCancel: () => void;
  onUpload: () => void;
}

export function UploadResumeDialog({
  open,
  onOpenChange,
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
}: UploadResumeDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload Resume</DialogTitle>
          <DialogDescription>
            Upload a PDF resume. It will be automatically parsed by AI.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Resume Title</Label>
            <Input
              id="title"
              value={uploadTitle}
              onChange={(e) => onUploadTitleChange(e.target.value)}
              placeholder="e.g. Frontend Developer"
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
                  variant="ghost"
                  size="icon-sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClearFile();
                  }}
                >
                  <X className="size-4" />
                </Button>
              </div>
            ) : (
              <>
                <Upload className="size-8 text-muted-foreground/50" />
                <p className="mt-2 text-sm font-medium">
                  Drop PDF here or click to browse
                </p>
                <p className="text-xs text-muted-foreground">PDF up to 10MB</p>
              </>
            )}
          </div>

          {uploadError && (
            <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="size-4 shrink-0" />
              {uploadError}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onCancel} disabled={uploading}>
              Cancel
            </Button>
            <Button onClick={onUpload} disabled={!selectedFile || uploading}>
              {uploading ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Upload className="size-4" />
                  Upload &amp; Parse
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
