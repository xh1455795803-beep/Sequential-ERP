-- 2026-11-17e 单据作废 → 未审费用行自动转出应付
-- =====================================================================
-- 现场问题（2026-11-17 生产审计）：全链路里没有任何一处会把 billing_lines 置为 voided
--   grep -rn "status: 'voided'" /opt/thalvior-source/functions/*/index.ts  → 0 命中
--   pg_trigger where tgrelid='shipments' → 0 个触发器
-- 而金额口径写的是「actual_amount = 有效费用行合计，排除 voided / rejected」。
-- 结果：拦截成功 / 作废的货件，之前试算出来的 pending_audit 费用行永远挂在应付里，
--       对账时还会被账单导入当成"系统已申报费用"去匹配，等于给死单付费。
--
-- 规则（与铁律2 同源：单据有效性与作业阶段分离，作废不等于删除记录）：
--   doc_status 由非 cancelled 变成 cancelled 时：
--     ① 该货件下 status='pending_audit' 且尚未挂对账单（statement_id is null）的费用行
--        → status='voided' + voided_reason（已挂单的行属于已发生的往来，必须人工走争议/手工作废）
--     ② 按 fee_currency 重算 shipments.actual_amount（与 webhook 的口径同式）
--   status='approved' 的行是人工确认过的应付，**不自动作废**，只能显式打回/作废 —— 避免系统悄悄改人已审记录。
-- 递归安全：WHEN 子句要求 doc_status 真正发生变化，函数内部再 UPDATE shipments 时条件不成立。
-- =====================================================================

create or replace function public.fn_shipments_cancel_void_fees()
returns trigger
language plpgsql
set search_path to 'public', 'auth', 'extensions'
as $fn$
declare
  v_cur text;
  v_voided int := 0;
begin
  v_cur := coalesce(nullif(btrim(coalesce(new.fee_currency, '')), ''), 'CNY');

  update public.billing_lines bl
     set status = 'voided',
         voided_reason = coalesce(nullif(btrim(coalesce(bl.voided_reason, '')), ''),
                                  '单据作废（doc_status=cancelled）自动转出应付'
                                  || case when btrim(coalesce(new.cancelled_reason, '')) <> ''
                                          then '：' || btrim(new.cancelled_reason) else '' end),
         updated_at = now()
   where bl.shipment_id = new.id
     and bl.status = 'pending_audit'
     and bl.statement_id is null;
  get diagnostics v_voided = row_count;

  update public.shipments s
     set actual_amount = coalesce((
           select sum(l.amount)
             from public.billing_lines l
            where l.shipment_id = new.id
              and l.status not in ('voided', 'rejected')
              and coalesce(nullif(btrim(l.currency), ''), 'CNY') = v_cur
         ), 0)::numeric(14,4),
         updated_at = now()
   where s.id = new.id;

  if v_voided > 0 then
    raise notice '货件 % 作废：费用行转出应付 % 条', new.id, v_voided;
  end if;
  return new;
end
$fn$;

drop trigger if exists trg_shipments_cancel_void_fees on public.shipments;
create trigger trg_shipments_cancel_void_fees
after update of doc_status on public.shipments
for each row
when (new.doc_status = 'cancelled' and old.doc_status is distinct from new.doc_status)
execute function public.fn_shipments_cancel_void_fees();

-- 回填：现网里已经作废、但作废前留下的未审费用行（触发器只对"状态发生变化"生效，这里手工补一次，逻辑与触发器同式）
update public.billing_lines bl
   set status = 'voided',
       voided_reason = coalesce(nullif(btrim(coalesce(bl.voided_reason, '')), ''),
                                '单据作废（doc_status=cancelled）自动转出应付'
                                || case when btrim(coalesce(s.cancelled_reason, '')) <> ''
                                        then '：' || btrim(s.cancelled_reason) else '' end),
       updated_at = now()
  from public.shipments s
 where s.id = bl.shipment_id
   and s.doc_status = 'cancelled'
   and bl.status = 'pending_audit'
   and bl.statement_id is null;

update public.shipments s
   set actual_amount = coalesce((
         select sum(l.amount) from public.billing_lines l
          where l.shipment_id = s.id and l.status not in ('voided','rejected')
            and coalesce(nullif(btrim(l.currency), ''), 'CNY') = coalesce(nullif(btrim(s.fee_currency), ''), 'CNY')
       ), 0)::numeric(14,4)
 where s.doc_status = 'cancelled';
