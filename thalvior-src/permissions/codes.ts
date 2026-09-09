// 权限码集中管理 - 前端 / 后端 / seed 都要对齐这一份
// 命名规则: <模块>:<动作>   例如 product:create / order:ship
// 通配: *:* 表示超级管理员
export const P = {
  // 仪表盘
  dashboard: {
    overview: 'dashboard:overview',
  },

  // 授权中心
  auth: {
    shopList: 'auth:shop:list',
    shopBind: 'auth:shop:bind',
    shopUnbind: 'auth:shop:unbind',
    log: 'auth:log:list',
  },

  // 产品
  product: {
    list: 'product:list',
    detail: 'product:detail',
    create: 'product:create',
    update: 'product:update',
    delete: 'product:delete',
    publish: 'product:publish',
    import: 'product:import',
    export: 'product:export',
  },

  // 订单
  order: {
    list: 'order:list',
    detail: 'order:detail',
    ship: 'order:ship',
    cancel: 'order:cancel',
    refund: 'order:refund',
    aftersale: 'order:aftersale',
    manualCreate: 'order:manual:create',
    print: 'order:print',
  },

  // 库存
  inventory: {
    list: 'inventory:list',
    adjust: 'inventory:adjust',
    transfer: 'inventory:transfer',
    stocktaking: 'inventory:stocktaking',
  },

  // 仓库
  warehouse: {
    list: 'warehouse:list',
    create: 'warehouse:create',
    update: 'warehouse:update',
    delete: 'warehouse:delete',
  },

  // 采购
  purchase: {
    list: 'purchase:list',
    create: 'purchase:create',
    approve: 'purchase:approve',
  },

  // 物流
  logistics: {
    channel: 'logistics:channel',
    track: 'logistics:track',
  },

  // 财务
  finance: {
    profit: 'finance:profit',
    reconcile: 'finance:reconcile',
    export: 'finance:export',
  },

  // 数据
  data: {
    overview: 'data:overview',
    export: 'data:export',
  },

  // 系统
  system: {
    subAccount: 'system:sub:manage',
    role: 'system:role:manage',
    global: 'system:global:manage',
    opLog: 'system:op:log',
    auditLog: 'system:audit:log',
    backup: 'system:backup',
    scheduler: 'system:scheduler',
    webhook: 'system:webhook',
  },

  // 平台
  platform: {
    list: 'platform:list',
    manage: 'platform:manage',
  },

  // 供应商
  supplier: {
    list: 'supplier:list',
    create: 'supplier:create',
    update: 'supplier:update',
  },

  // 角色
  role: {
    list: 'role:list',
    create: 'role:create',
    update: 'role:update',
    delete: 'role:delete',
  },
} as const;

// 把 P 拍平成字符串数组
type Leaf<T> = T extends string ? T : { [K in keyof T]: Leaf<T[K]> }[keyof T];
export type PermissionCode = Leaf<typeof P>;

// 预设角色 - 配合 seed.ts 一起用
export const ROLES = {
  admin: {
    code: 'admin',
    name: '超级管理员',
    description: '系统全部权限',
    permissions: '*:*',
  },
  operator: {
    code: 'operator',
    name: '运营',
    description: '日常运营权限',
    permissions: [
      // 仪表盘
      P.dashboard.overview,
      // 产品
      P.product.list, P.product.detail, P.product.create, P.product.update, P.product.delete, P.product.publish,
      // 订单
      P.order.list, P.order.detail, P.order.ship, P.order.cancel, P.order.refund, P.order.aftersale, P.order.manualCreate, P.order.print,
      // 库存
      P.inventory.list, P.inventory.adjust, P.inventory.transfer,
      // 仓库 / 采购 / 物流
      P.warehouse.list, P.purchase.list, P.purchase.create, P.logistics.channel, P.logistics.track,
      // 授权 / 平台 / 供应商 / 角色(只读)
      P.auth.shopList, P.auth.log, P.platform.list, P.supplier.list, P.role.list,
      // 数据
      P.data.overview,
    ].join(','),
  },
  viewer: {
    code: 'viewer',
    name: '只读',
    description: '仅查看',
    permissions: [
      P.dashboard.overview,
      P.product.list, P.product.detail,
      P.order.list, P.order.detail,
      P.inventory.list,
      P.warehouse.list,
      P.purchase.list,
      P.auth.shopList,
      P.platform.list,
      P.supplier.list,
      P.role.list,
      P.data.overview,
      P.finance.profit,
    ].join(','),
  },
} as const;
