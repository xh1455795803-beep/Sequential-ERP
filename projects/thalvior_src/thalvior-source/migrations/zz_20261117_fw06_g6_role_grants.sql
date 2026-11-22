-- =====================================================================
-- zz_20261117_fw06_g6_role_grants.sql
-- 把 G6（货代管理 + 物流管理）72 个权限点授予内置 owner / platform_admin
--
-- 起因（2026-11-17 第六轮，接前端权限时实测发现，是我自己上一轮的缺口）：
--   fw01–fw04 往 permissions 播了 47 个 logistics.* 权限点，但**一条
--   role_permissions 都没播**。实测现网覆盖：
--     owner=25/72、platform_admin=25/72、warehouse=25、finance=4、
--     ops_lead=6、support=7、viewer=7、custom=0
--   缺的 47 个**全部**是本轮新建的 key（rate / billing / statement / push /
--   packing / label / workorder / warehouse / inventory / sku_mapping /
--   switch / tracking / carrier_mapping / shipment.view）。
--   后果：has_perm() / my_permissions() 对新页面一律返回没有权限。
--   也就是说链路在库里建好了，但**权限这一环没接上，前端一接权限就全灰**。
--
-- 只补这两条角色的原因（不是偷懒）：
--   · owner = 租户主账号（profiles.owner_id IS NULL），在本项目权限模型里
--     就是"自己租户内全权"，has_perm 里给它走内置 owner 角色；
--   · platform_admin 原本与 owner 的 G6 覆盖完全一致（都是 25），保持同步；
--   · finance / ops_lead / support / warehouse / viewer / custom 六条角色
--     **一律不动**——它们的组合是运营策略，应该在「角色权限」后台按客户实际
--     岗位勾选，不该由一条迁移替所有租户拍板。profiles.role='admin' 走的是
--     has_role 超管绕过，本来就不需要授权行。
--
-- 幂等与安全边界：
--   · 用 **on conflict do nothing**（house 常见写法是 do update set
--     effect = excluded.effect，这里**故意不用**）——如果某租户的 owner 被
--     人工设成 deny，do update 会把这条 deny 覆盖成 allow，等于迁移擅自放权。
--     do nothing 只填空缺、不改既有授权，重放多少次结果都一样。
--   · 只按 group_code='G6' 圈定范围，不碰其它模块，不删任何行，不改 roles。
-- =====================================================================
SET search_path = public;

-- ① owner：租户主账号，补齐 G6 全部权限点
INSERT INTO public.role_permissions (role_id, permission_id, effect)
SELECT r.id, p.id, 'allow'
  FROM public.roles r, public.permissions p
 WHERE r.key = 'owner' AND r.is_builtin
   AND p.group_code = 'G6' AND p.is_active
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ② platform_admin：与 owner 保持同等 G6 覆盖
INSERT INTO public.role_permissions (role_id, permission_id, effect)
SELECT r.id, p.id, 'allow'
  FROM public.roles r, public.permissions p
 WHERE r.key = 'platform_admin' AND r.is_builtin
   AND p.group_code = 'G6' AND p.is_active
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMENT ON TABLE public.role_permissions IS
  '角色↔权限点授权（effect = allow/deny，deny 优先）。'
  '内置 owner / platform_admin 持有 G6 全量；其余角色由「角色权限」后台人工勾选。';

-- ---------------------------------------------------------------------
-- 自检：两条角色必须真的覆盖 G6 全量，缺一个就抛错（防止权限点以后再被
-- 新增却忘记授权——那正是本次事故的形成方式）
-- ---------------------------------------------------------------------
DO $q$
DECLARE v_total integer; v_missing_owner integer; v_missing_pa integer;
BEGIN
  SELECT count(*) INTO v_total FROM public.permissions
   WHERE group_code = 'G6' AND is_active;

  SELECT count(*) INTO v_missing_owner
    FROM public.permissions p
   WHERE p.group_code = 'G6' AND p.is_active
     AND NOT EXISTS (SELECT 1 FROM public.role_permissions rp
                       JOIN public.roles r ON r.id = rp.role_id AND r.key = 'owner'
                      WHERE rp.permission_id = p.id AND rp.effect = 'allow');

  SELECT count(*) INTO v_missing_pa
    FROM public.permissions p
   WHERE p.group_code = 'G6' AND p.is_active
     AND NOT EXISTS (SELECT 1 FROM public.role_permissions rp
                       JOIN public.roles r ON r.id = rp.role_id AND r.key = 'platform_admin'
                      WHERE rp.permission_id = p.id AND rp.effect = 'allow');

  IF v_total = 0 THEN
    RAISE EXCEPTION '[fw06 自检失败] G6 权限点为空，前序迁移未落库';
  END IF;
  IF v_missing_owner <> 0 OR v_missing_pa <> 0 THEN
    RAISE EXCEPTION '[fw06 自检失败] G6 共 % 个权限点，owner 缺 % 个 / platform_admin 缺 % 个',
      v_total, v_missing_owner, v_missing_pa;
  END IF;
  RAISE NOTICE '[fw06 自检通过] G6 共 % 个权限点，owner 与 platform_admin 均已全量 allow', v_total;
END $q$;

-- 本迁移对象清单：新建表 0 / 函数 0 / 视图 0 / 触发器 0；
-- 数据：role_permissions 最多 +94 行（owner 47 + platform_admin 47，已存在则跳过）。
