// 品牌 Logo（原创几何图形：极简圆角药丸形 "T" 字母）
// 全部由基础 SVG 路径手工绘制，无外部素材引用，不侵犯任何第三方版权
export default function BrandLogo({ size = 48, color = '#fff' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-label="thalvior logo">
      {/* 外框背景圆（可选，随 color 自动适配） */}
      <rect x="2" y="2" width="44" height="44" rx="12" fill={color} opacity="0.12" />
      {/* 横向药丸 - 顶部 */}
      <rect x="6" y="10" width="36" height="10" rx="5" fill={color} />
      {/* 纵向药丸 - 居中下垂 */}
      <rect x="19" y="18" width="10" height="24" rx="5" fill={color} />
    </svg>
  );
}
