// 通用导出工具：将数据导出为 CSV（Excel 可直接打开）
// 无需额外依赖，浏览器原生 Blob 下载

export function exportToCsv(
  filename: string,
  headers: string[],
  rows: (string | number)[][]
) {
  // 转义 CSV 字段（处理逗号、引号、换行）
  const escape = (v: string | number) => {
    const s = String(v ?? "");
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  // 加 BOM 让 Excel 正确识别 UTF-8 中文
  const csv = [
    headers.map(escape).join(","),
    ...rows.map((r) => r.map(escape).join(",")),
  ].join("\n");

  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}