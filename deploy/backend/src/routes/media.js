/**
 * 统一素材上传路由（图片上传/预览/删除/列表）
 * 物理存储：后端项目根目录下 uploads/media/[ym]/[id].[ext]
 * 访问地址：Nginx /uploads/(.*) -> /opt/shuxu-erp/backend/uploads/$1
 * 租户端：只能看自己的；admin: 0号公共域
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { query } = require('../db');

const router = express.Router();
const UPLOAD_ROOT = path.resolve(path.join(__dirname, '..', '..', 'uploads', 'media'));
if (!fs.existsSync(UPLOAD_ROOT)) fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
const PUBLIC_URL_PREFIX = '/uploads/media'; // Nginx 直接静态映射这个路径

const ALLOW_MIME = { 'image/jpeg':'jpg','image/jpg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','image/bmp':'bmp' };
const MAX_SIZE = 8 * 1024 * 1024; // 8MB 单图

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const ym = new Date().toISOString().slice(0,7).replace('-',''); // 202608
    const p = path.join(UPLOAD_ROOT, ym);
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
    cb(null, p);
  },
  filename: (req, file, cb) => {
    const ext = ALLOW_MIME[file.mimetype] || 'bin';
    const nano = process.hrtime.bigint ? String(process.hrtime.bigint()).slice(-10) : String(Math.floor(Math.random()*1e10));
    cb(null, `${Date.now()}_${nano}.${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE, files: 6 },
  fileFilter: (req, file, cb) => cb(null, !!ALLOW_MIME[file.mimetype])
});

/** 尺寸探测（纯Buffer头部，简单解析jpg/png/gif/webp宽高）*/
function probeSize(buffer) {
  try {
    const b = buffer;
    if (b.length < 24) return null;
    // JPEG
    if (b[0] === 0xFF && b[1] === 0xD8) {
      let i = 2;
      while (i < b.length - 9) {
        if (b[i] !== 0xFF) break;
        let mrk = b[i+1];
        if ((mrk >= 0xC0 && mrk <= 0xCF) && mrk !== 0xC4 && mrk !== 0xC8 && mrk !== 0xCC) {
          return { height: (b[i+5]<<8)|b[i+6], width: (b[i+7]<<8)|b[i+8] };
        }
        const segLen = (b[i+2]<<8)|b[i+3];
        i += 2 + segLen;
      }
    }
    // PNG
    if (b[0]===0x89 && b[1]===0x50 && b[2]===0x4E && b[3]===0x47) {
      return { width: (b[16]<<24|b[17]<<16|b[18]<<8|b[19])>>>0, height: (b[20]<<24|b[21]<<16|b[22]<<8|b[23])>>>0 };
    }
    // GIF
    if (b[0]===0x47 && b[1]===0x49 && b[2]===0x46) {
      return { width: b[6]|b[7]<<8, height: b[8]|b[9]<<8 };
    }
  } catch { /* ignore */ }
  return null;
}

// ========= 权限范围限定 =========
function getScope(req) {
  // req.user (租户) 或 req.admin (SaaS运营)
  if (req.admin) return { tenantId: 0, isAdmin: true, userId: req.admin.adminId };
  if (req.user)  return { tenantId: req.user.tenantId, isAdmin: false, userId: req.user.id };
  return null;
}

// 1. 上传（支持多张 files: files[]）
router.post('/upload', upload.array('files', 6), async (req, res, next) => {
  try {
    const scope = getScope(req);
    if (!scope) return res.status(401).json({ error: '请先登录' });
    const category = String(req.body.category || 'general').slice(0, 40);
    const files = Array.isArray(req.files) ? req.files : [];
    if (!files.length) return res.status(400).json({ error: '请选择图片文件' });
    const out = [];
    for (const f of files) {
      const ym = path.basename(path.dirname(f.path));
      const relative = `/${ym}/${f.filename}`;
      let size; try { size = fs.statSync(f.path).size; } catch { size = 0; }
      let dim = null; try { dim = probeSize(fs.readFileSync(f.path, { flag: 'r' })); } catch { /* ignore */ }
      const url = `${PUBLIC_URL_PREFIX}${relative}`;
      const id = crypto.randomBytes(8).toString('hex');
      // 幂等插入URL唯一索引（没有的话普通插入）
      const [r] = await query(
        `INSERT INTO media_assets
         (tenant_id, owner_user_id, category, original_name, stored_name, stored_path, access_url, mime_type, size_bytes, width, height, ext_info_json)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [scope.tenantId, scope.userId, category,
         f.originalname || null, f.filename, relative, url,
         f.mimetype || null, size,
         dim ? dim.width : null, dim ? dim.height : null,
         JSON.stringify({ diskDir: UPLOAD_ROOT })]
      );
      out.push({
        id: (r && r.insertId) ? Number(r.insertId) : id,
        name: f.originalname,
        url,
        size,
        width: dim && dim.width || null,
        height: dim && dim.height || null,
        mimeType: f.mimetype,
        category,
      });
    }
    res.json({ items: out, total: out.length });
  } catch (e) { next(e); }
});

// 2. 租户端/运营端：自己的资源列表（分页+分类筛选）
router.get('/', async (req, res, next) => {
  try {
    const scope = getScope(req);
    if (!scope) return res.status(401).json({ error: '请先登录' });
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const size = Math.min(80, Math.max(1, parseInt(req.query.size) || 24));
    const category = req.query.category ? String(req.query.category).slice(0,40) : null;
    const where = ['tenant_id = ?', 'is_deleted = 0']; const params = [scope.tenantId];
    if (category) { where.push('category = ?'); params.push(category); }
    const [cnt] = await query(`SELECT COUNT(*) c FROM media_assets WHERE ${where.join(' AND ')}`, params);
    const rows = await query(
      `SELECT id, category, original_name, access_url, size_bytes, width, height, created_at
       FROM media_assets WHERE ${where.join(' AND ')}
       ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, size, (page-1)*size]
    );
    res.json({
      total: (cnt && cnt[0] && cnt[0].c) ? Number(cnt[0].c) : 0,
      page, size,
      items: rows.map(r => ({
        id: r.id, category: r.category, name: r.original_name, url: r.access_url,
        size: Number(r.size_bytes||0), width: r.width, height: r.height,
        createdAt: r.created_at,
      }))
    });
  } catch (e) { next(e); }
});

// 3. 删除（软删 + 真实磁盘清理）
router.post('/delete', async (req, res, next) => {
  try {
    const scope = getScope(req);
    if (!scope) return res.status(401).json({ error: '请先登录' });
    const id = Number((req.body && req.body.id) || (req.params && req.params.id) || 0);
    if (!id) return res.status(400).json({ error: '参数缺失' });
    const [m] = await query('SELECT * FROM media_assets WHERE id = ? AND tenant_id = ? AND is_deleted = 0', [id, scope.tenantId]);
    if (!m) return res.status(404).json({ error: '资源不存在' });
    await query('UPDATE media_assets SET is_deleted = 1, deleted_at = NOW() WHERE id = ?', [id]);
    // 尝试清理物理文件
    try {
      const abs = path.join(UPLOAD_ROOT, String(m.stored_path || '').replace(/^\//, ''));
      if (fs.existsSync(abs)) fs.unlinkSync(abs);
    } catch { /* ignore */ }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
