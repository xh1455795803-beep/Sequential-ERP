// Tab D「服务目录」：读 forwarder_catalog（生产库实测 76 carrier + 30 overseas_warehouse + 0 forwarder_pack）
// 本 tab 不存在任何硬编码名录：kind / is_active / 名称搜索（ilike）都是数据库查询参数，分页与总数也来自服务端。
import { useState } from "react";
import { Check, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { tt } from "@/i18n/tts";
import { SearchField } from "@/components/filter-bar";
import { insertRow, queryTable, type TableFilter } from "@/lib/data-access";
import {
  Chip, EmptyRow, EnumBadge, ErrorRow, KIND_META, LoadingRow, Pager, Panel, Td, Th,
  mapCatalog, optionLabel, toOptions, useAsyncData, useForwarderOptions, type CatalogItem,
} from "./common";

const KIND_OPTIONS = toOptions(KIND_META);
const PAGE_SIZE = 20;

type Data = { rows: CatalogItem[]; total: number };
const emptyData: Data = { rows: [], total: 0 };

export function CatalogPanel() {
  const { forwarders } = useForwarderOptions();
  const [kind, setKind] = useState("carrier");
  const [kw, setKw] = useState("");
  const [page, setPage] = useState(1);
  const [addingId, setAddingId] = useState("");

  const myNames = new Set(forwarders.map((f) => f.name));
  const k = kw.trim().replace(/[%_*]/g, "");

  const { data, loading, error, reload } = useAsyncData<Data>(
    async () => {
      const fs: TableFilter[] = [
        { field: "kind", value: kind },
        { field: "is_active", value: "true" },
      ];
      if (k) fs.push({ field: "name", value: `%${k}%`, op: "ilike" });
      const from = (page - 1) * PAGE_SIZE;
      const res = await queryTable("forwarder_catalog", {
        filters: fs,
        order: { field: "name", ascending: true },
        range: { from, to: from + PAGE_SIZE - 1 },
        count: "exact",
      });
      return { rows: res.rows.map(mapCatalog), total: res.count ?? res.rows.length };
    },
    [kind, k, page],
    emptyData,
  );

  const pageCount = Math.max(1, Math.ceil(Math.max(data.total, data.rows.length) / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);

  const addToMine = async (c: CatalogItem) => {
    setAddingId(c.id);
    try {
      await insertRow("freight_forwarders", {
        name: c.name,
        channel: c.channel,
        intro: c.intro,
        // 来源标记为预置目录，便于后续区分自建与目录引入
        source: "preset_catalog",
      });
      toast.success(tt("fw.msg.addedFromCatalog", { v1: c.name }));
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tt("fw.msg.saveFail"));
    } finally {
      setAddingId("");
    }
  };

  const colCount = 6;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2.5 rounded-2xl border border-border bg-card px-4 py-3">
        <div className="flex flex-wrap gap-1.5">
          {KIND_OPTIONS.map((o) => (
            <button
              key={o.code}
              type="button"
              onClick={() => {
                setKind(o.code);
                setPage(1);
              }}
              className={
                "rounded-md border px-3 py-1.5 text-[12.5px] transition-colors " +
                (kind === o.code
                  ? "border-primary/60 bg-primary/10 font-medium text-primary"
                  : "border-border bg-background text-muted-foreground hover:border-primary/30")
              }
            >
              {tt(o.key)}
            </button>
          ))}
        </div>
        <SearchField
          value={kw}
          onChange={(v) => {
            setKw(v);
            setPage(1);
          }}
          placeholder={tt("fw.ph.catalogSearch")}
          width="w-56"
        />
        <span className="ml-auto text-xs text-muted-foreground">{tt("fw.ui.rowCount", { n: data.total })}</span>
        {loading ? <Loader2 size={14} className="animate-spin text-muted-foreground" /> : null}
        <Button size="sm" variant="outline" onClick={reload}>
          {tt("fw.ui.refresh")}
        </Button>
      </div>

      <Panel title={optionLabel(KIND_OPTIONS, kind)} meta={<span>{tt("fw.hint.catalogSource")}</span>}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
              <Th className="w-[26%]">{tt("fw.col.name")}</Th>
              <Th>{tt("fw.col.channel")}</Th>
              <Th>{tt("fw.col.region")}</Th>
              <Th>{tt("fw.col.days")}</Th>
              <Th>{tt("fw.col.scale")}</Th>
              <Th className="text-right">{tt("fw.col.actions")}</Th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <LoadingRow colSpan={colCount} />
            ) : error ? (
              <ErrorRow colSpan={colCount} message={error} onRetry={reload} />
            ) : data.rows.length === 0 ? (
              <EmptyRow
                colSpan={colCount}
                text={kw ? tt("fw.empty.catalogSearch") : tt("fw.empty.catalog")}
                hint={kw ? undefined : tt("fw.empty.catalogHint")}
                action={
                  kind === "forwarder_pack" ? (
                    <span className="text-xs text-muted-foreground">{tt("fw.hint.packCatalogPending")}</span>
                  ) : undefined
                }
              />
            ) : (
              data.rows.map((c) => {
                const added = myNames.has(c.name);
                return (
                  <tr key={c.id} className="border-b border-border transition-colors last:border-0 hover:bg-muted/60">
                    <Td className="align-top">
                      <div className="font-medium text-ink">{c.name}</div>
                      {c.intro ? <div className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{c.intro}</div> : null}
                    </Td>
                    <Td className="text-muted-foreground">{c.channel || "—"}</Td>
                    <Td className="text-muted-foreground">{c.region || "—"}</Td>
                    <Td className="text-muted-foreground">{c.days || "—"}</Td>
                    <Td>
                      <Chip tone={c.scale ? "info" : "mute"}>{c.scale || "—"}</Chip>
                      <div className="mt-1">
                        <EnumBadge value={c.kind} meta={KIND_META} />
                      </div>
                    </Td>
                    <Td>
                      <div className="flex justify-end">
                        {added ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-2 py-1 text-[11.5px] font-medium text-success">
                            <Check size={12} />
                            {tt("fw.tag.alreadyAdded")}
                          </span>
                        ) : (
                          <Button size="sm" variant="outline" className="h-7 px-2.5 text-[11.5px]" onClick={() => addToMine(c)} disabled={addingId === c.id}>
                            {addingId === c.id ? <Loader2 size={12} className="mr-1 animate-spin" /> : <Plus size={12} className="mr-1" />}
                            {tt("fw.act.addToMine")}
                          </Button>
                        )}
                      </div>
                    </Td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        <Pager page={safePage} pageCount={pageCount} onPage={setPage} />
      </Panel>
    </div>
  );
}
