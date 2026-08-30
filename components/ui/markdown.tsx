"use client";

import React, { memo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

interface MarkdownProps {
  content: string;
  className?: string;
  variant?: "default" | "inverted" | "amber";
}

function CodeBlock({
  children,
  className,
  variant,
}: {
  children: React.ReactNode;
  className?: string;
  variant: "default" | "inverted" | "amber";
}) {
  const [copied, setCopied] = useState(false);

  const rawCode = React.Children.toArray(children)
    .map((child) => {
      if (typeof child === "string") return child;
      if (
        React.isValidElement(child) &&
        child.props &&
        typeof (child.props as { children?: unknown }).children === "string"
      ) {
        return (child.props as { children: string }).children;
      }
      return "";
    })
    .join("");

  const handleCopy = async () => {
    if (!rawCode) return;
    try {
      await navigator.clipboard.writeText(rawCode.replace(/\n$/, ""));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const bgClasses =
    variant === "inverted"
      ? "bg-black/25 border-white/15 text-primary-foreground"
      : variant === "amber"
      ? "bg-amber-950/10 border-amber-500/20 text-amber-950 dark:text-amber-100"
      : "bg-muted/80 border-border/70 text-foreground";

  const buttonClasses =
    variant === "inverted"
      ? "text-primary-foreground/70 hover:text-primary-foreground hover:bg-white/10"
      : variant === "amber"
      ? "text-amber-800 dark:text-amber-300 hover:bg-amber-500/20"
      : "text-muted-foreground hover:text-foreground hover:bg-muted";

  return (
    <div className={cn("group relative my-3 overflow-hidden rounded-xl border", bgClasses, className)}>
      <div className="flex items-center justify-between border-b border-inherit px-3.5 py-1.5 text-[11px] font-mono text-muted-foreground">
        <span className="opacity-70">Code</span>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className={cn(
            "flex items-center gap-1 rounded-md px-1.5 py-0.5 transition-colors cursor-pointer",
            buttonClasses
          )}
          aria-label={copied ? "Copied" : "Copy code"}
        >
          {copied ? (
            <>
              <Check className="size-3 text-emerald-500" />
              <span className="text-[10px] text-emerald-500 font-sans">已复制</span>
            </>
          ) : (
            <>
              <Copy className="size-3" />
              <span className="text-[10px] font-sans">复制</span>
            </>
          )}
        </button>
      </div>
      <div className="overflow-x-auto p-3.5 font-mono text-[13px] leading-relaxed">
        {children}
      </div>
    </div>
  );
}

export const Markdown = memo(function Markdown({
  content,
  className,
  variant = "default",
}: MarkdownProps) {
  const isCandidate = variant === "inverted";
  const isAmber = variant === "amber";

  return (
    <div
      className={cn(
        "markdown-content text-inherit [overflow-wrap:anywhere]",
        className
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p({ children }) {
            return (
              <p className="mb-3 last:mb-0 leading-7 break-words">
                {children}
              </p>
            );
          },
          h1({ children }) {
            return (
              <h1 className="mt-4 mb-2 text-lg font-bold tracking-tight first:mt-0">
                {children}
              </h1>
            );
          },
          h2({ children }) {
            return (
              <h2 className="mt-3.5 mb-2 text-base font-bold tracking-tight first:mt-0">
                {children}
              </h2>
            );
          },
          h3({ children }) {
            return (
              <h3 className="mt-3 mb-1.5 text-sm font-semibold tracking-tight first:mt-0">
                {children}
              </h3>
            );
          },
          h4({ children }) {
            return (
              <h4 className="mt-2.5 mb-1 text-sm font-semibold first:mt-0">
                {children}
              </h4>
            );
          },
          ul({ children }) {
            return (
              <ul className="my-2.5 list-disc space-y-1.5 pl-5 leading-relaxed marker:opacity-70">
                {children}
              </ul>
            );
          },
          ol({ children }) {
            return (
              <ol className="my-2.5 list-decimal space-y-1.5 pl-5 leading-relaxed marker:opacity-70">
                {children}
              </ol>
            );
          },
          li({ children }) {
            return <li className="leading-relaxed">{children}</li>;
          },
          blockquote({ children }) {
            const bqBorder = isCandidate
              ? "border-primary-foreground/40 text-primary-foreground/90"
              : isAmber
              ? "border-amber-600/40 text-amber-950/85 dark:text-amber-200/85"
              : "border-primary/60 text-muted-foreground";
            return (
              <blockquote className={cn("my-2.5 border-l-2 pl-3.5 italic", bqBorder)}>
                {children}
              </blockquote>
            );
          },
          pre({ children }) {
            return <CodeBlock variant={variant}>{children}</CodeBlock>;
          },
          code({ className, children, ...props }) {
            const isCodeBlock = className?.includes("language-");
            if (isCodeBlock) {
              return (
                <code className={cn("font-mono", className)} {...props}>
                  {children}
                </code>
              );
            }

            const inlineClasses = isCandidate
              ? "bg-primary-foreground/20 border-primary-foreground/25 text-primary-foreground"
              : isAmber
              ? "bg-amber-500/15 border-amber-500/30 text-amber-950 dark:text-amber-200"
              : "bg-muted/80 border-border/80 text-foreground";

            return (
              <code
                className={cn(
                  "rounded-md border px-1.5 py-0.5 font-mono text-[0.875em]",
                  inlineClasses
                )}
                {...props}
              >
                {children}
              </code>
            );
          },
          a({ href, children }) {
            const linkColor = isCandidate
              ? "text-primary-foreground underline-offset-4 hover:opacity-80"
              : "text-primary underline-offset-4 hover:opacity-85";
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className={cn("underline font-medium break-all", linkColor)}
              >
                {children}
              </a>
            );
          },
          strong({ children }) {
            return <strong className="font-semibold">{children}</strong>;
          },
          em({ children }) {
            return <em className="italic">{children}</em>;
          },
          hr() {
            const hrBorder = isCandidate
              ? "border-primary-foreground/20"
              : isAmber
              ? "border-amber-500/30"
              : "border-border/80";
            return <hr className={cn("my-4 border-t", hrBorder)} />;
          },
          table({ children }) {
            const tableBorder = isCandidate
              ? "border-primary-foreground/20"
              : isAmber
              ? "border-amber-500/30"
              : "border-border/80";
            return (
              <div className={cn("my-3 overflow-x-auto rounded-xl border", tableBorder)}>
                <table className="w-full text-left text-xs">{children}</table>
              </div>
            );
          },
          thead({ children }) {
            const theadBg = isCandidate
              ? "bg-primary-foreground/10 border-primary-foreground/20"
              : isAmber
              ? "bg-amber-500/10 border-amber-500/20"
              : "bg-muted/60 border-border/70";
            return (
              <thead className={cn("border-b font-medium", theadBg)}>
                {children}
              </thead>
            );
          },
          tbody({ children }) {
            const tbodyDivide = isCandidate
              ? "divide-primary-foreground/15"
              : isAmber
              ? "divide-amber-500/20"
              : "divide-border/50";
            return <tbody className={cn("divide-y", tbodyDivide)}>{children}</tbody>;
          },
          tr({ children }) {
            return <tr>{children}</tr>;
          },
          th({ children }) {
            return <th className="px-3.5 py-2 font-semibold">{children}</th>;
          },
          td({ children }) {
            return <td className="px-3.5 py-2">{children}</td>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
