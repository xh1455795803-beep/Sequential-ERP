// 配置加载：环境变量由 systemd EnvironmentFile 或 shell 注入
module.exports = {
  port: parseInt(process.env.PORT || '8090', 10),
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'shuxu',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'shuxu_erp',
    connectionLimit: 8,
    timezone: '+08:00',
    charset: 'utf8mb4'
  },
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES || '12h'
};
