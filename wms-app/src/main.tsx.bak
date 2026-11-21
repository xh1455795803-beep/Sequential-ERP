import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider, createRouter, createRootRoute, createRoute } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { supabase } from './lib/supabase';
import { AppLayout } from './components/AppLayout';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { WarehousesPage } from './pages/WarehousesPage';
import { LocationsPage } from './pages/LocationsPage';
import { AsnsPage, AsnDetailPage } from './pages/AsnsPage';
import { ShipmentsPage, ShipmentDetailPage } from './pages/ShipmentsPage';
import { InventoryPage } from './pages/InventoryPage';
import { StocktakingPage } from './pages/StocktakingPage';
import { ProductsPage } from './pages/ProductsPage';
import { OrdersPage, OrderDetailPage } from './pages/OrdersPage';
import { ChannelsPage } from './pages/ChannelsPage';
import { ExceptionsPage } from './pages/ExceptionsPage';
import ErpConnectionPage from './pages/ErpConnectionPage';
import StoreBindingPage from './pages/StoreBindingPage';
// PDA
import PdaReceive from './pages/mobile/PdaReceive';
import PdaPutaway from './pages/mobile/PdaPutaway';
import PdaPick from './pages/mobile/PdaPick';
import PdaPack from './pages/mobile/PdaPack';
import './styles.css';
import './pwa/registerSW';

// ============ meoo 风格 EmptyState 占位页 ============
function PlaceholderPage({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center p-12 text-center">
      {/* 购物车 SVG 插画（meoo empty-state-hTlzZwJf.js 同款风格） */}
      <svg width="120" height="120" viewBox="0 0 120 120" fill="none" className="mb-6 opacity-60">
        <circle cx="100" cy="20" r="2" fill="var(--text-subtle)" fillOpacity="0.4" />
        <circle cx="90" cy="30" r="3" fill="var(--text-subtle)" fillOpacity="0.3" />
        <circle cx="108" cy="40" r="1.5" fill="var(--text-subtle)" fillOpacity="0.5" />
        {/* 包裹箱 */}
        <rect x="28" y="42" width="52" height="44" rx="4" stroke="var(--border)" strokeWidth="1.5" strokeDasharray="4 3" />
        <path d="M28 56h52M40 42v44M68 42v44" stroke="var(--border)" strokeWidth="1" strokeOpacity="0.5" />
        {/* 放大镜 */}
        <circle cx="78" cy="72" r="10" stroke="var(--brand)" strokeWidth="2" />
        <path d="M85 79l8 8" stroke="var(--brand)" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <h2 className="mb-1 text-base font-semibold text-fg">{title}</h2>
      <p className="text-sm text-fg-muted max-w-sm">
        {hint || '此模块为货小易 ERP 核心功能，WMS 专注仓库管理场景。'}
      </p>
    </div>
  );
}

// ============ Auth ============
async function requireAuth() {
  // 跳过登录页本身（path === '/' 是 loginRoute）
  const p = window.location.pathname.replace('/wms', '') || '/';
  if (p === '/' || p === '') return null;  // 登录页不需要 session
  
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('UNAUTHORIZED');
  return session;
}

const rootRoute = createRootRoute();

// ============ Login ============
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: LoginPage,
});

// ============ Protected Layout ============
const layoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  beforeLoad: requireAuth,
  component: AppLayout,
});

// ------- Overview -------
const dashRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/dashboard', component: DashboardPage });

// ------- Business: 订单 group -------
const ordersRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/orders', component: OrdersPage });
const orderDetailRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/orders/$id', component: OrderDetailPage });
const ordersToShipRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/orders/to-ship', component: () => <PlaceholderPage title="待发货订单" hint="筛选状态为已打印面单、待打包发货的订单。" /> });
const ordersAfterSaleRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/orders/after-sale', component: () => <PlaceholderPage title="售后管理" hint="退货/退款/换货请求处理中心。" /> });
const ordersRulesRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/orders/rules', component: () => <PlaceholderPage title="订单规则" hint="自动合并/拆分/分配订单规则配置。" /> });
const ordersSettingsRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/orders/settings', component: () => <PlaceholderPage title="订单设置" hint="订单编号规则、自动确认、超时处理等。" /> });

// ------- Business: 客服 group -------
const csRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/cs', component: () => <PlaceholderPage title="客服收件箱" hint="来自各平台的站内信和工单统一入口。" /> });
const csReviewsRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/cs/reviews', component: () => <PlaceholderPage title="评价管理" hint="各平台店铺评价聚合与回复。" /> });
const csDisputesRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/cs/disputes', component: () => <PlaceholderPage title="纠纷/Case" hint="平台纠纷和 Case 跟踪处理。" /> });

// ------- Business: 商品 group -------
const productsRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/products', component: ProductsPage });
const productsCollectRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/products/collect', component: () => <PlaceholderPage title="选品采集" hint="从 1688/速卖通/TikTok Shop 等平台一键采集商品。" /> });
const productsMaterialRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/products/material', component: () => <PlaceholderPage title="素材库" hint="图片/视频/描述等商品素材管理。" /> });
const productsCategoriesRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/products/categories', component: () => <PlaceholderPage title="分类管理" hint="平台类目 → 内部类目映射。" /> });
const productsBrandsRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/products/brands', component: () => <PlaceholderPage title="品牌管理" hint="品牌信息、备案资料、授权证书。" /> });
const productsPricingRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/products/pricing', component: () => <PlaceholderPage title="定价模板" hint="按平台/类目/SKU 设置自动定价规则。" /> });

// ------- Business: Listing group -------
const listingRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/listing', component: () => <PlaceholderPage title="Listing 总览" hint="全平台上架中的商品与待上架 Listing 看板。" /> });
const listingTemplatesRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/listing/templates', component: () => <PlaceholderPage title="模板管理" hint="Listing 模板（标题/五点/关键词）复用。" /> });
const listingMappingsRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/listing/mappings', component: () => <PlaceholderPage title="字段映射" hint="商品属性 → 平台字段映射规则。" /> });
const listingBatchRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/listing/batch', component: () => <PlaceholderPage title="批量发布" hint="多选 SKU → 批量 Listing 到多店铺。" /> });
const listingLogsRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/listing/logs', component: () => <PlaceholderPage title="发布日志" hint="Listing 发布/更新/下架历史记录。" /> });

// ------- Business: 库存 group（核心，WMS 重点）-------
const inventoryRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/inventory', component: InventoryPage });
const inventorySkusRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/inventory/skus', component: ProductsPage });
const inventoryWarehousesRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/inventory/warehouses', component: WarehousesPage });
const inventoryLocationsRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/inventory/locations', component: LocationsPage });
const inventoryAdjustmentsRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/inventory/adjustments', component: () => <PlaceholderPage title="库存调整" hint="盘盈盘亏、质量冻结、调拨等手动调整单据。" /> });
const inventoryCountsRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/inventory/counts', component: StocktakingPage });
const inventoryAlertsRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/inventory/alerts', component: () => <PlaceholderPage title="库存告警" hint="低于安全库存、超期、不可售等告警汇总。" /> });
const inventoryLowStockRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/inventory/low-stock', component: () => <PlaceholderPage title="低库存清单" hint="低于安全线的 SKU 列表（可一键补货下单）。" /> });
const inventoryOutOfStockRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/inventory/out-of-stock', component: () => <PlaceholderPage title="缺货清单" hint="库存为 0 的 SKU 列表。" /> });
const inventoryStrategiesRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/inventory/strategies', component: () => <PlaceholderPage title="库存策略" hint="自动补货 / 自动下架 / 安全线等策略配置。" /> });
const inventoryLogsRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/inventory/logs', component: () => <PlaceholderPage title="库存流水" hint="出入库/调拨/盘点/调整等全部流水记录。" /> });

// ------- Business: 履约 group -------
const fulfillmentRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/fulfillment', component: ShipmentsPage });
const fulfillmentShippingTasksRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/fulfillment/shipping-tasks', component: ShipmentsPage });
const fulfillmentSplitRulesRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/fulfillment/split-rules', component: () => <PlaceholderPage title="拆单规则" hint="根据仓库/SKU/重量自动拆单的规则引擎。" /> });
const fulfillmentOutboundRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/fulfillment/outbound', component: ShipmentsPage });

// ------- Business: 物流 group -------
const logisticsRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/logistics', component: ChannelsPage });
const logisticsChannelRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/logistics/channel', component: ChannelsPage });
const logisticsQuoteRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/logistics/quote', component: () => <PlaceholderPage title="运费报价" hint="按重量/尺寸/目的地实时查询各渠道报价。" /> });
const logisticsParcelsRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/logistics/parcels', component: ShipmentsPage });
const logisticsWaybillsRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/logistics/waybills', component: ShipmentsPage });
const logisticsTrackingRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/logistics/tracking', component: () => <PlaceholderPage title="物流追踪" hint="运单号批量查询在途状态。" /> });
const logisticsReconcileRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/logistics/reconcile', component: () => <PlaceholderPage title="物流对账" hint="按账单周期核对渠道/货代/仓储费用。" /> });

// ------- Business: 采购 group -------
const purchaseOrdersRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/purchase/orders', component: () => <PlaceholderPage title="采购订单" hint="向供应商下达的采购订单统一入口。" /> });
const purchaseSuppliersRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/purchase/suppliers', component: () => <PlaceholderPage title="供应商管理" hint="供应商档案、分级、付款条件。" /> });
const purchaseReturnsRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/purchase/returns', component: () => <PlaceholderPage title="采购退货" hint="质量不合格 / 发错货的退货流程。" /> });
const purchasePlanRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/purchase/plan', component: () => <PlaceholderPage title="补货计划" hint="基于销量预测 + 库存水位自动生成补货建议。" /> });
const purchaseInboundRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/purchase/inbound', component: AsnsPage });
const purchaseSuggestionRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/purchase/suggestion', component: () => <PlaceholderPage title="补货建议 AI" hint="基于销量、季节性、在途库存自动生成补货建议。" /> });

// ------- Business: 自动化 group -------
const automationRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/automation', component: () => <PlaceholderPage title="自动化规则" hint="订单 → 履约 → 物流 → 通知全链路自动化规则引擎。" /> });
const automationRunsRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/automation/runs', component: () => <PlaceholderPage title="执行日志" hint="规则引擎每次触发的执行记录。" /> });
const automationFailuresRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/automation/failures', component: () => <PlaceholderPage title="失败告警" hint="规则执行失败的告警汇总与一键重试。" /> });

// ------- Business: 异常 & 认证（叶子）-------
const exceptionsRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/exceptions', component: ExceptionsPage });
const authRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/auth', component: () => <PlaceholderPage title="账号与权限" hint="子账号管理、角色权限、双因子认证。" /> });

// ------- Assets: 财务 group -------
const financeRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/finance', component: () => <PlaceholderPage title="财务总览" hint="收支看板、应收应付账龄、现金流曲线。" /> });
const financeFeeRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/finance/fee', component: () => <PlaceholderPage title="平台费用" hint="各平台手续费抽佣明细台账。" /> });
const financeFeesRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/finance/fees', component: () => <PlaceholderPage title="费用台账" hint="运费/仓储/佣金/关税等费用明细账。" /> });
const financeReconcileRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/finance/reconcile', component: () => <PlaceholderPage title="银行对账" hint="流水导入 → 自动匹配 → 差异核对。" /> });
const financeInvoiceRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/finance/invoice', component: () => <PlaceholderPage title="发票管理" hint="开票申请、进项发票登记、税务申报。" /> });
const financeIncomeRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/finance/income', component: () => <PlaceholderPage title="收入台账" hint="平台结算/PayPal/Stripe 回款明细。" /> });
const financeReceivableRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/finance/receivable', component: () => <PlaceholderPage title="应收账款" hint="账龄分析、催收提醒、坏账处理。" /> });
const financePayableRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/finance/payable', component: () => <PlaceholderPage title="应付账款" hint="供应商应付、账龄分析、付款计划。" /> });
const financeCostRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/finance/cost', component: () => <PlaceholderPage title="成本核算" hint="SKU 级成本拆解：采购+物流+关税+佣金。" /> });
const financeFxRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/finance/fx', component: () => <PlaceholderPage title="汇率管理" hint="实时汇率、历史曲线、换汇记录。" /> });
const financeProfitRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/finance/profit', component: () => <PlaceholderPage title="利润分析" hint="SKU/店铺/平台/地区利润多维透视。" /> });

// ------- Assets: 报表 group -------
const reportsRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/reports', component: () => <PlaceholderPage title="销售报表" hint="销量/销售额/客单价/转化率趋势看板。" /> });
const reportsOrdersRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/reports/orders', component: () => <PlaceholderPage title="订单报表" hint="订单量/渠道分布/时效达成率。" /> });
const reportsInventoryRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/reports/inventory', component: () => <PlaceholderPage title="库存报表" hint="周转率/库龄/滞销/缺货率。" /> });
const reportsPurchaseRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/reports/purchase', component: () => <PlaceholderPage title="采购报表" hint="采购周期/供应商交付/价格波动。" /> });
const reportsLogisticsRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/reports/logistics', component: () => <PlaceholderPage title="物流报表" hint="渠道时效/丢件率/签收率/运费占比。" /> });
const reportsAfterSalesRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/reports/after-sales', component: () => <PlaceholderPage title="售后报表" hint="退货率/纠纷率/退款率/平均处理时长。" /> });
const reportsFinanceRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/reports/finance', component: () => <PlaceholderPage title="财务报表" hint="利润表/资产负债表/现金流量表。" /> });
const reportsProfitRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/reports/profit', component: () => <PlaceholderPage title="利润中心" hint="SKU/店铺/平台/地区利润对比。" /> });
const reportsShopsRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/reports/shops', component: () => <PlaceholderPage title="店铺经营" hint="各店铺 GMV/动销/客单价/评分。" /> });
const reportsPlatformRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/reports/platform', component: () => <PlaceholderPage title="平台对比" hint="不同平台的经营指标横向对比。" /> });
const reportsRegionRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/reports/region', component: () => <PlaceholderPage title="地区分析" hint="按国家/地区的销量/利润/退货率。" /> });

// ------- Assets: AI group -------
const aiWorkbenchRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/ai/workbench', component: () => <PlaceholderPage title="AI 工作台" hint="选品/关键词/图片/描述/定价 AI 助手集合。" /> });
const aiListingRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/ai/listing', component: () => <PlaceholderPage title="AI Listing" hint="一键生成多平台 Listing（标题/五点/关键词）。" /> });
const aiListingCnRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/ai/listing-cn', component: () => <PlaceholderPage title="AI Listing 中文版" hint="中文平台（抖音/拼多多/1688）Listing 生成。" /> });
const aiToolsRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/ai/tools', component: () => <PlaceholderPage title="AI 工具箱" hint="翻译/润色/图片生成/SKU 命名等工具集合。" /> });
const aiCollectRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/ai/collect', component: () => <PlaceholderPage title="AI 选品" hint="输入关键词 → AI 分析市场/竞争/利润空间。" /> });
const aiResourcesRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/ai/resources', component: () => <PlaceholderPage title="AI 资源库" hint="Prompt 模板/模型配置/历史生成记录。" /> });

// ------- Assets: 工具 group -------
const toolsCurrencyRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/tools/currency', component: () => <PlaceholderPage title="汇率换算" hint="多币种实时换算器（绑定实时汇率）。" /> });
const toolsProfitCalcRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/tools/profit-calc', component: () => <PlaceholderPage title="利润计算器" hint="输入成本/运费/佣金 → 实时算利润和利润率。" /> });
const toolsPriceCalcRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/tools/price-calc', component: () => <PlaceholderPage title="定价计算器" hint="目标利润率反推建议售价（含各平台费用）。" /> });
const toolsMarginCalcRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/tools/margin-calc', component: () => <PlaceholderPage title="毛利率计算器" hint="快速算毛利率（(售价-成本)/售价）。" /> });
const toolsShippingCalcRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/tools/shipping-calc', component: () => <PlaceholderPage title="运费计算器" hint="按重量/尺寸/目的地/渠道计算运费。" /> });
const toolsDimCalcRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/tools/dim-calc', component: () => <PlaceholderPage title="体积重计算器" hint="长×宽×高 / 6000 → 体积重 vs 实重取大。" /> });
const toolsFbaRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/tools/fba', component: () => <PlaceholderPage title="FBA 费用" hint="FBA 配送费/仓储费/移除费预估。" /> });
const toolsTaxRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/tools/tax', component: () => <PlaceholderPage title="关税计算" hint="HS Code → 目的国税率 → 落地费预估。" /> });
const toolsKeywordRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/tools/keyword', component: () => <PlaceholderPage title="关键词工具" hint="平台搜索量/竞争度/建议竞价关键词挖掘。" /> });
const toolsCompetitorRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/tools/competitor', component: () => <PlaceholderPage title="竞品分析" hint="输入 ASIN/Listing URL → 竞品销量/价格/评论分析。" /> });

// ------- WMS 独有路由（meoo 没有，但 WMS 保留）-------
const warehousesRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/warehouses', component: WarehousesPage });
const locationsRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/locations', component: LocationsPage });
const asnsRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/asns', component: AsnsPage });
const asnDetailRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/asns/$id', component: AsnDetailPage });
const shipmentsRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/shipments', component: ShipmentsPage });
const shipmentDetailRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/shipments/$id', component: ShipmentDetailPage });
const channelsRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/channels', component: ChannelsPage });
const stocktakingRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/stocktaking', component: StocktakingPage });
const erpRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/erp', component: ErpConnectionPage });
const storesRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/stores', component: StoreBindingPage });

// ------- PDA 移动端 -------
const pdaHubRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/pda', component: () => null });
const pdaReceiveRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/pda/receive', component: PdaReceive });
const pdaPutawayRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/pda/putaway', component: PdaPutaway });
const pdaPickRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/pda/pick', component: PdaPick });
const pdaPackRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/pda/pack', component: PdaPack });

// ============ 路由树（按 meoo section 顺序）============
const routeTree = rootRoute.addChildren([
  loginRoute,
  layoutRoute.addChildren([
    // Overview
    dashRoute,
    // Business → 订单
    ordersRoute, orderDetailRoute, ordersToShipRoute, ordersAfterSaleRoute, ordersRulesRoute, ordersSettingsRoute,
    // Business → 客服
    csRoute, csReviewsRoute, csDisputesRoute,
    // Business → 商品
    productsRoute, productsCollectRoute, productsMaterialRoute, productsCategoriesRoute, productsBrandsRoute, productsPricingRoute,
    // Business → Listing
    listingRoute, listingTemplatesRoute, listingMappingsRoute, listingBatchRoute, listingLogsRoute,
    // Business → 库存（WMS 核心）
    inventoryRoute, inventorySkusRoute, inventoryWarehousesRoute, inventoryLocationsRoute,
    inventoryAdjustmentsRoute, inventoryCountsRoute, inventoryAlertsRoute,
    inventoryLowStockRoute, inventoryOutOfStockRoute, inventoryStrategiesRoute, inventoryLogsRoute,
    // Business → 履约
    fulfillmentRoute, fulfillmentShippingTasksRoute, fulfillmentSplitRulesRoute, fulfillmentOutboundRoute,
    // Business → 物流
    logisticsRoute, logisticsChannelRoute, logisticsQuoteRoute, logisticsParcelsRoute, logisticsWaybillsRoute, logisticsTrackingRoute, logisticsReconcileRoute,
    // Business → 采购
    purchaseOrdersRoute, purchaseSuppliersRoute, purchaseReturnsRoute, purchasePlanRoute, purchaseInboundRoute, purchaseSuggestionRoute,
    // Business → 自动化
    automationRoute, automationRunsRoute, automationFailuresRoute,
    // Business leaf
    exceptionsRoute, authRoute,
    // Assets → 财务
    financeRoute, financeFeeRoute, financeFeesRoute, financeReconcileRoute, financeInvoiceRoute, financeIncomeRoute, financeReceivableRoute, financePayableRoute, financeCostRoute, financeFxRoute, financeProfitRoute,
    // Assets → 报表
    reportsRoute, reportsOrdersRoute, reportsInventoryRoute, reportsPurchaseRoute, reportsLogisticsRoute, reportsAfterSalesRoute, reportsFinanceRoute, reportsProfitRoute, reportsShopsRoute, reportsPlatformRoute, reportsRegionRoute,
    // Assets → AI
    aiWorkbenchRoute, aiListingRoute, aiListingCnRoute, aiToolsRoute, aiCollectRoute, aiResourcesRoute,
    // Assets → 工具
    toolsCurrencyRoute, toolsProfitCalcRoute, toolsPriceCalcRoute, toolsMarginCalcRoute, toolsShippingCalcRoute, toolsDimCalcRoute, toolsFbaRoute, toolsTaxRoute, toolsKeywordRoute, toolsCompetitorRoute,
    // WMS 独有
    warehousesRoute, locationsRoute, asnsRoute, asnDetailRoute, shipmentsRoute, shipmentDetailRoute, channelsRoute, stocktakingRoute, erpRoute, storesRoute,
    // PDA
    pdaHubRoute, pdaReceiveRoute, pdaPutawayRoute, pdaPickRoute, pdaPackRoute,
  ]),
]);

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000 } },
});

const router = createRouter({
  routeTree,
  basepath: '/wms',
  defaultPreload: 'intent',
  defaultErrorComponent: ({ error }: any) => {
    if (error?.message === 'UNAUTHORIZED') {
      const u = new URL(window.location.href);
      u.pathname = '/wms/';
      window.location.replace(u.toString());
      return null;
    }
    return (
      <div className="p-8 text-center text-destructive">
        <h2 className="text-xl font-semibold mb-2">出错了</h2>
        <p className="text-sm text-fg-muted">{error?.message}</p>
        <button onClick={() => window.location.reload()} className="mt-4 px-4 py-2 rounded-md bg-brand text-brand-ink text-sm font-medium hover:bg-brand-hover transition">刷新</button>
      </div>
    );
  },
});

declare module '@tanstack/react-router' {
  interface Register { router: typeof router }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>
);
