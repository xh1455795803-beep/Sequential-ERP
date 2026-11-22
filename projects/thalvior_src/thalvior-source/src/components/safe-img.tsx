// 商品缩略图兜底：URL 失效/空值时渲染中性占位（纯展示层，不写库）
import { useState } from "react";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";

export function SafeImg({
  src,
  alt,
  className,
}: {
  src?: string | null;
  alt: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <span
        className={cn(
          "flex shrink-0 items-center justify-center border border-border bg-muted/40 text-muted-foreground/50",
          className,
        )}
        role="img"
        aria-label={alt}
      >
        <ImageOff size={16} strokeWidth={1.8} />
      </span>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className={className}
      onError={() => setFailed(true)}
    />
  );
}
