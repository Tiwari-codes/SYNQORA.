const mysql = require('mysql2');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'synqora_pro',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
}).promise();

pool.getConnection()
  .then(conn => {
    console.log('✅ Connected to MySQL Database (synqora_pro)');
    conn.release();
  })
  .catch(err => {
    console.error('⚠️ MySQL Connection failed (Running in graceful fallback mode):', err.message);
  });

module.exports = pool;
