"use client";

import { ArrowRight, Loader2, Mic, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InterviewRichTextEditor } from "@/components/interview/interview-rich-text-editor";

type InterviewAnswerPanelProps = {
  placeholder: string;
  helperText: string;
  answerText: string;
  submitting: boolean;
  disabled?: boolean;
  resetKey: string | number;
  skipLabel: string;
  audioLabel: string;
  submitLabel: string;
  onAnswerChange: (plainText: string) => void;
  onSkip: () => void;
  onSubmit: () => void;
};

export function InterviewAnswerPanel({
  placeholder,
  helperText,
  answerText,
  submitting,
  disabled = false,
  resetKey,
  skipLabel,
  audioLabel,
  submitLabel,
  onAnswerChange,
  onSkip,
  onSubmit,
}: InterviewAnswerPanelProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-card">
      <InterviewRichTextEditor
        value={answerText}
        placeholder={placeholder}
        helperText={helperText}
        disabled={submitting || disabled}
        resetKey={resetKey}
        onChange={onAnswerChange}
      />

      <div className="flex items-center justify-between border-t px-5 py-3">
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={onSkip}
          disabled={submitting || disabled}
        >
          <SkipForward className="size-4" />
          {skipLabel}
        </Button>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={submitting || disabled}>
            <Mic className="size-4" />
            {audioLabel}
          </Button>
          <Button
            size="sm"
            onClick={onSubmit}
            disabled={submitting || disabled || !answerText.trim()}
          >
            {submitting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <>
                {submitLabel}
                <ArrowRight className="size-4" />
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
