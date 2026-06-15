const express = require('express');
const cors = require('cors');
const apiRoutes = require('./routes/api');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Base routes check
app.get('/ping', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date(), service: 'CRM Backend' });
});

// Debug tables endpoint
const db = require('./config/database');
app.get('/debug/tables', async (req, res) => {
  try {
    const result = await db.raw('SHOW TABLES');
    res.json({ success: true, tables: result[0] || result });
  } catch (err) {
    console.error('Debug tables error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Load routes
app.use('/api', apiRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled Error:', err.message);
  res.status(500).json({ success: false, error: err.message });
});

app.listen(PORT, () => {
  console.log(`CRM Backend running on port ${PORT}`);
});
