/**
 * Request Validation Middleware for CRM Endpoints.
 * Ensures incoming HTTP payloads have required fields before reaching controllers.
 */

function validateSegmentAI(req, res, next) {
  const { prompt } = req.body;
  if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
    return res.status(400).json({
      success: false,
      error: "Validation Error: 'prompt' must be a non-empty string."
    });
  }
  next();
}

function validateSegmentSave(req, res, next) {
  const { name, sql_query } = req.body;
  if (!name || typeof name !== 'string' || name.trim() === '') {
    return res.status(400).json({
      success: false,
      error: "Validation Error: 'name' must be a non-empty string."
    });
  }
  if (!sql_query || typeof sql_query !== 'string' || sql_query.trim() === '') {
    return res.status(400).json({
      success: false,
      error: "Validation Error: 'sql_query' must be a non-empty SQL query string."
    });
  }
  next();
}

function validateCampaignSave(req, res, next) {
  const { name, segment_id, subject_line, message_template } = req.body;
  
  if (!name || typeof name !== 'string' || name.trim() === '') {
    return res.status(400).json({ success: false, error: "Validation Error: 'name' is required." });
  }
  if (!segment_id || isNaN(segment_id)) {
    return res.status(400).json({ success: false, error: "Validation Error: 'segment_id' must be a valid number." });
  }
  if (!subject_line || typeof subject_line !== 'string' || subject_line.trim() === '') {
    return res.status(400).json({ success: false, error: "Validation Error: 'subject_line' is required." });
  }
  if (!message_template || typeof message_template !== 'string' || message_template.trim() === '') {
    return res.status(400).json({ success: false, error: "Validation Error: 'message_template' is required." });
  }
  next();
}

module.exports = {
  validateSegmentAI,
  validateSegmentSave,
  validateCampaignSave
};
