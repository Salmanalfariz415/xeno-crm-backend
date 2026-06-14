const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function setup() {
  const host = process.env.DB_HOST || '127.0.0.1';
  const user = process.env.DB_USER || 'root';
  const password = process.env.DB_PASSWORD || '';
  const database = process.env.DB_NAME || 'xeno_crm';

  console.log(`Connecting to MySQL at ${host} as ${user}...`);
  
  let connection;
  try {
    // Connect without database to create it
    connection = await mysql.createConnection({ host, user, password });
    console.log('Successfully connected to MySQL database engine.');
  } catch (err) {
    console.error('MySQL Connection Error:', err.message);
    console.error('Please verify that MySQL is running and your credentials in backend/.env are correct.');
    process.exit(1);
  }

  try {
    console.log(`Creating database: ${database} if not exists...`);
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${database}\`;`);
    await connection.query(`USE \`${database}\`;`);

    const sqlPath = path.join(__dirname, '../migrations/init_schema.sql');
    console.log(`Reading schema script from ${sqlPath}...`);
    const schemaSql = fs.readFileSync(sqlPath, 'utf8');

    // Strip comments before splitting by semicolon
    const cleanSql = schemaSql
      .replace(/\/\*[\s\S]*?\*\//g, '') // remove block comments
      .replace(/--.*$/gm, '');          // remove single line comments

    const statements = cleanSql
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.toLowerCase().startsWith('create database') && !stmt.toLowerCase().startsWith('use'));

    console.log(`Running schema migration (${statements.length} SQL statements)...`);
    for (const stmt of statements) {
      // Execute each query statement individually
      await connection.query(stmt);
    }
    console.log('Schema tables created successfully.');

    // Seed mock data
    console.log('Seeding initial customers...');
    const seedCustomers = [
      { first_name: 'Alice', last_name: 'Smith', email: 'alice.smith@example.com', phone: '+12025550143', location: 'New York', attributes: JSON.stringify({ gender: 'F', loyalty_tier: 'Gold', interests: ['shoes', 'clothing'] }) },
      { first_name: 'Bob', last_name: 'Jones', email: 'bob.jones@example.com', phone: '+13125550189', location: 'Chicago', attributes: JSON.stringify({ gender: 'M', loyalty_tier: 'Silver', interests: ['sports', 'outdoors'] }) },
      { first_name: 'Charlie', last_name: 'Brown', email: 'charlie.brown@example.com', phone: '+12125550101', location: 'New York', attributes: JSON.stringify({ gender: 'M', loyalty_tier: 'Bronze', interests: ['books', 'coffee'] }) },
      { first_name: 'Diana', last_name: 'Prince', email: 'diana.prince@example.com', phone: '+13105550172', location: 'Los Angeles', attributes: JSON.stringify({ gender: 'F', loyalty_tier: 'Platinum', interests: ['fashion', 'jewelry'] }) },
      { first_name: 'Evan', last_name: 'Wright', email: 'evan.wright@example.com', phone: '+17735550155', location: 'Chicago', attributes: JSON.stringify({ gender: 'M', loyalty_tier: 'Gold', interests: ['electronics', 'tech'] }) },
      { first_name: 'Fiona', last_name: 'Gallagher', email: 'fiona.gallagher@example.com', phone: '+16175550166', location: 'Boston', attributes: JSON.stringify({ gender: 'F', loyalty_tier: 'Silver', interests: ['appliances', 'gardening'] }) },
      { first_name: 'George', last_name: 'Costanza', email: 'george.costanza@example.com', phone: '+17185550199', location: 'New York', attributes: JSON.stringify({ gender: 'M', loyalty_tier: 'Bronze', interests: ['food', 'jackets'] }) }
    ];

    for (const customer of seedCustomers) {
      await connection.query(
        'INSERT INTO customers (first_name, last_name, email, phone, location, attributes) VALUES (?, ?, ?, ?, ?, ?)',
        [customer.first_name, customer.last_name, customer.email, customer.phone, customer.location, customer.attributes]
      );
    }

    // Get inserted customer IDs
    const [rows] = await connection.query('SELECT id, email FROM customers');
    const customerMap = {};
    rows.forEach(r => { customerMap[r.email] = r.id; });

    console.log('Seeding initial orders...');
    const seedOrders = [
      { email: 'alice.smith@example.com', order_number: 'ORD-1001', total_amount: 150.00, order_date: '2026-05-10 14:30:00' },
      { email: 'alice.smith@example.com', order_number: 'ORD-1002', total_amount: 250.00, order_date: '2026-06-01 10:15:00' },
      { email: 'bob.jones@example.com', order_number: 'ORD-1003', total_amount: 80.00, order_date: '2026-04-15 09:00:00' },
      { email: 'diana.prince@example.com', order_number: 'ORD-1004', total_amount: 600.00, order_date: '2026-05-20 18:45:00' },
      { email: 'diana.prince@example.com', order_number: 'ORD-1005', total_amount: 400.00, order_date: '2026-06-10 11:30:00' },
      { email: 'charlie.brown@example.com', order_number: 'ORD-1006', total_amount: 45.00, order_date: '2026-06-12 16:00:00' },
      { email: 'evan.wright@example.com', order_number: 'ORD-1007', total_amount: 320.00, order_date: '2026-05-25 13:20:00' }
    ];

    for (const order of seedOrders) {
      const customerId = customerMap[order.email];
      if (customerId) {
        await connection.query(
          'INSERT INTO orders (customer_id, order_number, total_amount, order_date) VALUES (?, ?, ?, ?)',
          [customerId, order.order_number, order.total_amount, order.order_date]
        );
      }
    }

    console.log('Database and seeds setup finished successfully!');
  } catch (err) {
    console.error('Setup Error during database creation/seeding:', err.message);
  } finally {
    if (connection) await connection.end();
  }
}

setup();
