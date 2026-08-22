// 数据库连接池与事务封装
const mysql = require('mysql2/promise');
const config = require('./config');

const pool = mysql.createPool(config.db);

async function query(sql, params) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

// 事务包装：fn(conn) 内所有操作同生共死
async function withTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { pool, query, withTransaction };
