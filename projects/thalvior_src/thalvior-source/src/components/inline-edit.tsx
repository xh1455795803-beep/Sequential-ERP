// 表格行内编辑单元格：点击进入编辑，回车/失焦提交，Esc 取消
// 乐观更新由父级负责：onCommit 先改本地 state 再发请求，失败回滚 + toast
import { useEffect, useRef, useState } from "react";
import { Check, Pencil, X } from "lucide-react";

interface InlineEditCellProps {
  value: string | number | null | undefined;
  type?: "text" | "number";
  placeholder?: string;
  onCommit: (next: string) => boolean | void | Promise<boolean | void>;
  className?: string;
}

export function InlineEditCell({ value, type = "text", placeholder, onCommit, className }: InlineEditCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(value == null ? "" : String(value));
  }, [value, editing]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const submit = () => {
    const next = draft.trim();
    if (next === String(value ?? "").trim()) {
      setEditing(false);
      return;
    }
    // 父级同步执行：返回 false 表示校验失败不退出编辑
    const ok = onCommit(next);
    if (ok !== false) setEditing(false);
  };

  const cancel = () => {
    setDraft(value == null ? "" : String(value));
    setEditing(false);
  };

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          type={type === "number" ? "number" : "text"}
          step={type === "number" ? "0.01" : undefined}
          min={type === "number" ? 0 : undefined}
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
            e.stopPropagation();
          }}
          onClick={(e) => e.stopPropagation()}
          className="h-6 w-full min-w-16 rounded border border-primary/50 bg-background px-1.5 text-[12.5px] text-foreground outline-none"
        />
        <button
          onClick={(e) => {
            e.stopPropagation();
            submit();
          }}
          className="rounded p-0.5 text-success hover:bg-success-bg"
          title="OK"
        >
          <Check size={13} />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            cancel();
          }}
          className="rounded p-0.5 text-muted-foreground hover:bg-muted"
          title="Esc"
        >
          <X size={13} />
        </button>
      </span>
    );
  }

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
      className={`group/ie inline-flex max-w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left transition-colors hover:bg-muted ${className ?? ""}`}
      title="Click to edit"
    >
      <span className={`truncate ${value == null || value === "" ? "text-muted-foreground/40" : ""}`}>
        {value == null || value === "" ? placeholder || "—" : value}
      </span>
      <Pencil size={11} className="shrink-0 text-muted-foreground/0 transition-colors group-hover/ie:text-muted-foreground/70" />
    </button>
  );
}
