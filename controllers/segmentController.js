const db = require('../config/database');
const aiService = require('../services/aiService');

/**
 * Translate natural language prompt to SQL segment definition and return preview count.
 */
async function aiGenerateSegment(req, res) {
  try {
    const { prompt } = req.body;
    if (!prompt || prompt.trim() === '') {
      return res.status(400).json({ success: false, error: 'Prompt is required' });
    }

    // Call Gemini to generate rules and SQL query
    const translation = await aiService.generateSegmentRules(prompt);
    
    // Default fallback rules/params check
    const rules = translation.rules || [];
    const sqlQuery = translation.sql_query || '';
    const sqlParams = translation.sql_params || [];

    // Run preview count against MySQL
    let previewCount = 0;
    try {
      if (sqlQuery) {
        // Run the parameterized raw select query
        const [rows] = await db.raw(sqlQuery, sqlParams);
        previewCount = rows ? rows.length : 0;
      }
    } catch (dbErr) {
      console.error('Database segment preview count failed:', dbErr.message);
    }

    res.json({
      success: true,
      rules,
      sql_query: sqlQuery,
      sql_params: sqlParams,
      previewCount
    });
  } catch (err) {
    console.error('Error in aiGenerateSegment:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * Save Segment Definition.
 */
async function createSegment(req, res) {
  try {
    const { name, description, rules, sql_query, sql_params, query_type, raw_prompt } = req.body;

    if (!name || !sql_query) {
      return res.status(400).json({ success: false, error: 'Name and SQL query are required' });
    }

    const [id] = await db('segments').insert({
      name,
      description,
      rules: JSON.stringify(rules || []),
      sql_query,
      sql_params: JSON.stringify(sql_params || []),
      query_type: query_type || 'manual',
      raw_prompt
    });

    // Run count
    let count = 0;
    try {
      const [rows] = await db.raw(sql_query, sql_params || []);
      count = rows ? rows.length : 0;
    } catch (e) {}

    res.status(201).json({
      success: true,
      segment: {
        id,
        name,
        description,
        count
      }
    });
  } catch (err) {
    console.error('Error in createSegment:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * List all Saved Segments.
 * Includes customer count calculations per segment dynamically.
 */
async function getSegments(req, res) {
  try {
    const segments = await db('segments').select('*').orderBy('created_at', 'desc');

    // Calculate customer counts for each segment dynamically
    const enrichedSegments = [];
    for (const segment of segments) {
      let count = 0;
      try {
        const sqlParams = segment.sql_params 
          ? (typeof segment.sql_params === 'string' ? JSON.parse(segment.sql_params) : segment.sql_params)
          : [];
        const [rows] = await db.raw(segment.sql_query, sqlParams);
        count = rows ? rows.length : 0;
      } catch (err) {
        console.error(`Error counting segment ${segment.id}:`, err.message);
      }

      enrichedSegments.push({
        ...segment,
        rules: typeof segment.rules === 'string' ? JSON.parse(segment.rules) : segment.rules,
        sql_params: typeof segment.sql_params === 'string' ? JSON.parse(segment.sql_params) : segment.sql_params,
        customerCount: count
      });
    }

    res.json({
      success: true,
      segments: enrichedSegments
    });
  } catch (err) {
    console.error('Error in getSegments:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * Retrieve Segment qualified customer profiles.
 */
async function getSegmentCustomers(req, res) {
  try {
    const { id } = req.params;
    const segment = await db('segments').where('id', id).first();
    if (!segment) {
      return res.status(404).json({ success: false, error: 'Segment not found' });
    }

    const sqlParams = segment.sql_params 
      ? (typeof segment.sql_params === 'string' ? JSON.parse(segment.sql_params) : segment.sql_params)
      : [];

    // Execute query to get matching customer IDs
    const [idRows] = await db.raw(segment.sql_query, sqlParams);
    const customerIds = idRows.map(r => r.id);

    if (customerIds.length === 0) {
      return res.json({ success: true, customers: [] });
    }

    // Retrieve full customer records joining summary stats
    const customers = await db('customers')
      .whereIn('id', customerIds)
      .select('*');

    const formattedCustomers = customers.map(c => ({
      ...c,
      attributes: typeof c.attributes === 'string' ? JSON.parse(c.attributes) : c.attributes
    }));

    res.json({
      success: true,
      customers: formattedCustomers
    });
  } catch (err) {
    console.error('Error in getSegmentCustomers:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = {
  aiGenerateSegment,
  createSegment,
  getSegments,
  getSegmentCustomers
};
