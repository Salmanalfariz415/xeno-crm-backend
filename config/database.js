const knex = require('knex');
require('dotenv').config();

const db = knex({
  client: 'mysql2',
  connection: {
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'xeno_crm',
    charset: 'utf8mb4'
  },
  pool: {
    min: 2,
    max: 10
  }
});

module.exports = db;
