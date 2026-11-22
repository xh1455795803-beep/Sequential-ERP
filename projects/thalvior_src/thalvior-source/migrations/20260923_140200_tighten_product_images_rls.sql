-- ============================================
-- product-images 存储桶 RLS 收紧：上传/删除仅限本人，读取保持公开
-- 修复越权风险：登录用户 A 不得覆盖/删除用户 B 的商品图片
-- ============================================

-- 删除旧的宽松策略（登录用户可上传、匿名可读）
DROP POLICY IF EXISTS authenticated_insert_product_images ON storage.objects;
DROP POLICY IF EXISTS anon_select_product_images ON storage.objects;

-- 读取：保持公开（商品图需匿名可显示）
CREATE POLICY anon_select_product_images ON storage.objects
  FOR SELECT USING (bucket_id = 'd1439de1-7fc8-470b-93ba-152887a05385');

-- 上传：仅登录用户本人（owner 为 auth.uid()）
CREATE POLICY authenticated_insert_product_images ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'd1439de1-7fc8-470b-93ba-152887a05385'
    AND auth.role() = 'authenticated'
    AND owner = auth.uid()
  );

-- 更新：仅本人
CREATE POLICY authenticated_update_product_images ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'd1439de1-7fc8-470b-93ba-152887a05385'
    AND owner = auth.uid()
  );

-- 删除：仅本人
CREATE POLICY authenticated_delete_product_images ON storage.objects
  FOR DELETE USING (
    bucket_id = 'd1439de1-7fc8-470b-93ba-152887a05385'
    AND owner = auth.uid()
  );