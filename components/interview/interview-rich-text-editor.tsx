"use client";

import { useEffect } from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Bold, Code2, Italic, List, ListOrdered, Quote } from "lucide-react";
import { Button } from "@/components/ui/button";

type InterviewRichTextEditorProps = {
  value: string;
  placeholder: string;
  helperText: string;
  disabled?: boolean;
  resetKey: string | number;
  onChange: (plainText: string) => void;
};

export function InterviewRichTextEditor({
  value,
  placeholder,
  helperText,
  disabled = false,
  resetKey,
  onChange,
}: InterviewRichTextEditorProps) {
  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder,
      }),
    ],
    editorProps: {
      attributes: {
        class: "tiptap h-full text-sm leading-6 outline-none",
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      onChange(currentEditor.getText({ blockSeparator: "\n\n" }));
    },
  });

  const toolbarState = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => ({
      bold: currentEditor?.isActive("bold") ?? false,
      italic: currentEditor?.isActive("italic") ?? false,
      codeBlock: currentEditor?.isActive("codeBlock") ?? false,
      bulletList: currentEditor?.isActive("bulletList") ?? false,
      orderedList: currentEditor?.isActive("orderedList") ?? false,
      blockquote: currentEditor?.isActive("blockquote") ?? false,
    }),
  });
  const activeState = toolbarState ?? {
    bold: false,
    italic: false,
    codeBlock: false,
    bulletList: false,
    orderedList: false,
    blockquote: false,
  };

  useEffect(() => {
    if (!editor) {
      return;
    }
    editor.setEditable(!disabled);
  }, [disabled, editor]);

  useEffect(() => {
    if (!editor) {
      return;
    }
    editor.commands.clearContent(true);
    onChange("");
  }, [editor, onChange, resetKey]);

  useEffect(() => {
    if (!editor) {
      return;
    }
    const editorText = editor.getText({ blockSeparator: "\n\n" }).trim();
    if (!value.trim() && editorText) {
      editor.commands.clearContent(true);
    }
  }, [editor, value]);

  return (
    <div className="interview-rich-editor flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b px-5 py-2.5">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant={activeState.bold ? "secondary" : "ghost"}
            size="icon-sm"
            disabled={!editor || disabled}
            onClick={() => editor?.chain().focus().toggleBold().run()}
          >
            <Bold className="size-4" />
          </Button>
          <Button
            type="button"
            variant={activeState.italic ? "secondary" : "ghost"}
            size="icon-sm"
            disabled={!editor || disabled}
            onClick={() => editor?.chain().focus().toggleItalic().run()}
          >
            <Italic className="size-4" />
          </Button>
          <Button
            type="button"
            variant={activeState.codeBlock ? "secondary" : "ghost"}
            size="icon-sm"
            disabled={!editor || disabled}
            onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
          >
            <Code2 className="size-4" />
          </Button>
          <Button
            type="button"
            variant={activeState.bulletList ? "secondary" : "ghost"}
            size="icon-sm"
            disabled={!editor || disabled}
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
          >
            <List className="size-4" />
          </Button>
          <Button
            type="button"
            variant={activeState.orderedList ? "secondary" : "ghost"}
            size="icon-sm"
            disabled={!editor || disabled}
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered className="size-4" />
          </Button>
          <Button
            type="button"
            variant={activeState.blockquote ? "secondary" : "ghost"}
            size="icon-sm"
            disabled={!editor || disabled}
            onClick={() => editor?.chain().focus().toggleBlockquote().run()}
          >
            <Quote className="size-4" />
          </Button>
        </div>
        <span className="text-xs text-muted-foreground">{helperText}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="h-full rounded-md border bg-background/60 p-4">
          <EditorContent editor={editor} className="h-full" />
        </div>
      </div>
    </div>
  );
}
