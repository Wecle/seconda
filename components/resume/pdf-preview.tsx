"use client";

import { useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { AlertCircle, Loader2, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

interface ResumePdfPreviewProps {
  fileUrl: string;
  filename: string;
}

export function ResumePdfPreview({ fileUrl, filename }: ResumePdfPreviewProps) {
  const [pdfNumPages, setPdfNumPages] = useState(0);
  const [pdfScale, setPdfScale] = useState(1);
  const [pdfLoadError, setPdfLoadError] = useState<string | null>(null);

  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="mb-3 flex items-center justify-between px-2">
        <p className="text-sm font-medium">{filename}</p>
        <a
          href={fileUrl}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-primary hover:underline"
        >
          Open in new tab
        </a>
      </div>
      <div className="space-y-3 rounded-lg border bg-background p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="px-1 text-xs text-muted-foreground">
            {pdfNumPages > 0 ? `Total ${pdfNumPages} pages` : "Loading pages..."}
          </p>

          <div className="inline-flex items-center gap-1">
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              onClick={() => setPdfScale((prev) => Math.max(0.6, prev - 0.1))}
            >
              <ZoomOut className="size-3.5" />
            </Button>
            <p className="w-12 text-center text-xs text-muted-foreground">
              {Math.round(pdfScale * 100)}%
            </p>
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              onClick={() => setPdfScale((prev) => Math.min(2.2, prev + 0.1))}
            >
              <ZoomIn className="size-3.5" />
            </Button>
          </div>
        </div>

        {pdfLoadError ? (
          <div className="flex h-[calc(100vh-380px)] items-center justify-center rounded-md border border-destructive/30 bg-destructive/5 p-4 text-center">
            <div className="space-y-2">
              <AlertCircle className="mx-auto size-8 text-destructive/70" />
              <p className="text-sm font-medium text-destructive">
                Failed to load PDF preview
              </p>
              <p className="text-xs text-muted-foreground">{pdfLoadError}</p>
            </div>
          </div>
        ) : (
          <div className="h-[calc(100vh-380px)] overflow-auto rounded-md border bg-muted/20 p-3">
            <Document
              file={fileUrl}
              loading={
                <div className="flex h-full min-h-60 items-center justify-center">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              }
              onLoadSuccess={({ numPages }) => {
                setPdfNumPages(numPages);
                setPdfLoadError(null);
              }}
              onLoadError={(error) => {
                setPdfLoadError(error.message);
              }}
            >
              <div className="space-y-4">
                {Array.from({ length: pdfNumPages }, (_, index) => (
                  <div key={`page-${index + 1}`} className="flex justify-center">
                    <Page
                      pageNumber={index + 1}
                      scale={pdfScale}
                      renderAnnotationLayer={false}
                      renderTextLayer={false}
                      loading={
                        <div className="flex h-60 items-center justify-center">
                          <Loader2 className="size-5 animate-spin text-muted-foreground" />
                        </div>
                      }
                    />
                  </div>
                ))}
              </div>
            </Document>
          </div>
        )}
      </div>
    </div>
  );
}
