import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { cn } from "@/lib/utils"

export function Markdown({
  children,
  className,
}: {
  children: string
  className?: string
}) {
  return (
    <div className={cn("prose prose-sm dark:prose-invert max-w-none", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="mb-2 list-disc pl-4 last:mb-0">{children}</ul>,
          ol: ({ children }) => <ol className="mb-2 list-decimal pl-4 last:mb-0">{children}</ol>,
          li: ({ children }) => <li className="mb-0.5">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          code: ({ children, className }) => {
            const isInline = !className
            if (isInline) {
              return (
                <code className="rounded bg-muted px-1 py-0.5 text-[0.85em] font-mono">
                  {children}
                </code>
              )
            }
            return (
              <code className={cn("block rounded-md bg-muted p-3 text-[0.85em] font-mono overflow-x-auto", className)}>
                {children}
              </code>
            )
          },
          pre: ({ children }) => <pre className="mb-2 last:mb-0">{children}</pre>,
          h1: ({ children }) => <h3 className="mb-1.5 mt-3 text-sm font-bold first:mt-0">{children}</h3>,
          h2: ({ children }) => <h3 className="mb-1.5 mt-3 text-sm font-bold first:mt-0">{children}</h3>,
          h3: ({ children }) => <h4 className="mb-1 mt-2 text-sm font-semibold first:mt-0">{children}</h4>,
          blockquote: ({ children }) => (
            <blockquote className="mb-2 border-l-2 border-muted-foreground/30 pl-3 italic text-muted-foreground last:mb-0">
              {children}
            </blockquote>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
