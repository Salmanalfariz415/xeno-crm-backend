const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');
require('dotenv').config();

// Initialize AI clients based on keys configured in .env
const geminiKey = process.env.GEMINI_API_KEY;
const openaiKey = process.env.OPENAI_API_KEY;

const genAI = geminiKey && geminiKey !== 'YOUR_GEMINI_API_KEY_HERE' ? new GoogleGenerativeAI(geminiKey) : null;
const openai = openaiKey && openaiKey !== 'YOUR_OPENAI_API_KEY_HERE' ? new OpenAI({ apiKey: openaiKey }) : null;

/**
 * Natural Language Segmentation helper.
 * Translates a user description to DB rules and a parameterized SQL query.
 */
async function generateSegmentRules(promptText) {
  const systemPrompt = `You are a MySQL database and AI marketing engineer.
Your job is to translate a brand user's natural language segmentation prompt into a structured filters rules array, a parameterized SQL query, and query parameters.

Database Schema:
1. Table \`customers\` (columns: \`id\`, \`first_name\`, \`last_name\`, \`email\`, \`phone\`, \`location\`, \`attributes\` (JSON column for dynamic attributes like tier, gender), \`created_at\`)
2. Table \`orders\` (columns: \`id\`, \`customer_id\`, \`order_number\`, \`total_amount\`, \`order_date\`, \`created_at\`)

Rules Schema:
Each rule in the "rules" array must be an object with:
- "field": String (one of: 'location', 'total_spending', 'orders_count', 'last_purchase_date', or dynamic JSON paths like 'attributes.gender', 'attributes.loyalty_tier')
- "operator": String (one of: 'equals', 'not_equals', 'greater_than', 'less_than', 'contains')
- "value": Any (the value of the filter)

SQL Query Schema:
- Generate a SELECT statement that returns ONLY the customer \`id\` column from the \`customers\` table.
- Use parameterized query syntax where values are replaced with "?" in the "sql_query" string, and the actual values are pushed into the "sql_params" array in exact order of occurrence.
- For "total_spending" or "orders_count", write subqueries or aggregates joining the \`orders\` table. E.g., total spend >= X is: id IN (SELECT customer_id FROM orders GROUP BY customer_id HAVING SUM(total_amount) >= ?)
- For "last_purchase_date", group by customer_id and get MAX(order_date) compare with ?.
- Ensure the syntax is valid MySQL.

Response JSON Schema:
{
  "rules": [ { "field": "field_name", "operator": "op", "value": "val" } ],
  "sql_query": "SELECT id FROM customers WHERE ...",
  "sql_params": [value1, value2]
}`;

  // Priority 1: OpenAI GPT-4o-mini
  if (openai) {
    try {
      console.log('[AI SERVICE] Routing segmentation translation request to OpenAI (gpt-4o-mini)...');
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Translate this query: "${promptText}"` }
        ],
        response_format: { type: 'json_object' }
      });
      return JSON.parse(response.choices[0].message.content);
    } catch (error) {
      console.error('OpenAI Segmentation Error:', error.message);
      return getFallbackSegment(promptText);
    }
  }

  // Priority 2: Google Gemini (gemini-1.5-flash)
  if (genAI) {
    try {
      console.log('[AI SERVICE] Routing segmentation translation request to Gemini (gemini-1.5-flash)...');
      const model = genAI.getGenerativeModel({
        model: 'gemini-1.5-flash',
        generationConfig: { responseMimeType: 'application/json' }
      });
      const result = await model.generateContent(`${systemPrompt}\n\nTranslate this query: "${promptText}"`);
      return JSON.parse(result.response.text());
    } catch (error) {
      console.error('Gemini AI Segmentation Error:', error.message);
      return getFallbackSegment(promptText);
    }
  }

  // Fallback: Offline Mock translation
  console.warn('[AI SERVICE] No AI API keys configured. Executing offline segment fallbacks...');
  return getFallbackSegment(promptText);
}

/**
 * AI Message Copy generation helper.
 * Generates subject line and body templates with placeholders.
 */
async function generateCampaignCopy(prompt, segmentName, tone) {
  const systemPrompt = `You are a copywriting expert and product marketer.
Generate three campaign template variations containing a "subject_line" and "message_template" based on the goal prompt, segment, and tone.

Guidelines:
- Personalize content using handlebar syntax fields. Available fields: {{first_name}}, {{last_name}}, {{location}}.
- Make the writing engaging, professional, and matching the requested tone.
- Return the output strictly as a JSON object containing a "variations" array of objects.

Response JSON Schema:
{
  "variations": [
    {
      "subject_line": "Subject template here",
      "message_template": "Body text template here"
    }
  ]
}`;

  // Priority 1: OpenAI GPT-4o-mini
  if (openai) {
    try {
      console.log('[AI SERVICE] Routing campaign copywriting request to OpenAI (gpt-4o-mini)...');
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Generate copies for: Goal="${prompt}", Segment="${segmentName}", Tone="${tone}"` }
        ],
        response_format: { type: 'json_object' }
      });
      const data = JSON.parse(response.choices[0].message.content);
      return data.variations || data;
    } catch (error) {
      console.error('OpenAI Copywriting Error:', error.message);
      return [getFallbackCopy(prompt, segmentName, tone)];
    }
  }

  // Priority 2: Google Gemini (gemini-1.5-flash)
  if (genAI) {
    try {
      console.log('[AI SERVICE] Routing campaign copywriting request to Gemini (gemini-1.5-flash)...');
      const model = genAI.getGenerativeModel({
        model: 'gemini-1.5-flash',
        generationConfig: { responseMimeType: 'application/json' }
      });
      const result = await model.generateContent(`${systemPrompt}\n\nGenerate copies for: Goal="${prompt}", Segment="${segmentName}", Tone="${tone}"`);
      const data = JSON.parse(result.response.text());
      return data.variations || data;
    } catch (error) {
      console.error('Gemini AI Copywriting Error:', error.message);
      return [getFallbackCopy(prompt, segmentName, tone)];
    }
  }

  // Fallback: Offline copy drafts suggestion
  console.warn('[AI SERVICE] No AI API keys configured. Executing offline copywriting fallbacks...');
  return [getFallbackCopy(prompt, segmentName, tone)];
}

/**
 * AI Analytics performance advisor helper.
 * Summarizes metrics and provides suggestions.
 */
async function generateAnalyticsInsights(campaignData) {
  const systemPrompt = `You are an expert Chief Marketing Officer (CMO) and analytics advisor.
Review the following metrics for the completed campaign:
- Campaign Name: ${campaignData.name}
- Audience Segment: ${campaignData.segment_name}
- Sent: ${campaignData.sent_count}
- Delivered: ${campaignData.delivered_count}
- Failed: ${campaignData.failed_count}
- Opened: ${campaignData.opened_count}
- Read: ${campaignData.read_count}
- Clicked: ${campaignData.clicked_count}
- Converted (Orders Placed): ${campaignData.conversion_count}
- Conversion Rate: ${campaignData.conversion_rate}%

Provide 3 key insights about what performed well or failed, and 3 specific, actionable recommendations to improve future campaigns for this segment.
Return output in a clean JSON format.

Response JSON Schema:
{
  "insights": [
    "Insight point 1...",
    "Insight point 2..."
  ],
  "recommendations": [
    "Recommendation 1...",
    "Recommendation 2..."
  ]
}`;

  // Priority 1: OpenAI GPT-4o-mini
  if (openai) {
    try {
      console.log('[AI SERVICE] Routing analytics insights request to OpenAI (gpt-4o-mini)...');
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt }
        ],
        response_format: { type: 'json_object' }
      });
      return JSON.parse(response.choices[0].message.content);
    } catch (error) {
      console.error('OpenAI Insights Error:', error.message);
      return getFallbackInsights(campaignData);
    }
  }

  // Priority 2: Google Gemini (gemini-1.5-flash)
  if (genAI) {
    try {
      console.log('[AI SERVICE] Routing analytics insights request to Gemini (gemini-1.5-flash)...');
      const model = genAI.getGenerativeModel({
        model: 'gemini-1.5-flash',
        generationConfig: { responseMimeType: 'application/json' }
      });
      const result = await model.generateContent(systemPrompt);
      return JSON.parse(result.response.text());
    } catch (error) {
      console.error('Gemini AI Insights Error:', error.message);
      return getFallbackInsights(campaignData);
    }
  }

  // Fallback: Offline marketing reviews
  console.warn('[AI SERVICE] No AI API keys configured. Executing offline insights fallbacks...');
  return getFallbackInsights(campaignData);
}

// ==========================================
// FALLBACK FUNCTIONS FOR OFFLINE / MOCK MODE
// ==========================================

function getFallbackSegment(promptText) {
  const normalized = promptText.toLowerCase();
  
  if (normalized.includes('new york') || normalized.includes('ny')) {
    if (normalized.includes('300') || normalized.includes('spend')) {
      return {
        rules: [
          { field: 'location', operator: 'equals', value: 'New York' },
          { field: 'total_spending', operator: 'greater_than', value: 300 }
        ],
        sql_query: "SELECT id FROM customers WHERE location = ? AND id IN (SELECT customer_id FROM orders GROUP BY customer_id HAVING SUM(total_amount) > ?)",
        sql_params: ['New York', 300]
      };
    }
    return {
      rules: [{ field: 'location', operator: 'equals', value: 'New York' }],
      sql_query: "SELECT id FROM customers WHERE location = ?",
      sql_params: ['New York']
    };
  }

  if (normalized.includes('chicago')) {
    return {
      rules: [{ field: 'location', operator: 'equals', value: 'Chicago' }],
      sql_query: "SELECT id FROM customers WHERE location = ?",
      sql_params: ['Chicago']
    };
  }

  return {
    rules: [],
    sql_query: "SELECT id FROM customers WHERE 1 = 1",
    sql_params: []
  };
}

function getFallbackCopy(prompt, segmentName, tone) {
  return {
    subject_line: `Hey {{first_name}}! Special promotion for you! 🎉`,
    message_template: `Hi {{first_name}},\n\nWe noticed you are shopping from {{location}}! In appreciation of your support in our ${segmentName} group, here is a special code for you: SUMMER20.\n\nEnjoy,\nThe Team`
  };
}

function getFallbackInsights(campaignData) {
  const openRate = campaignData.delivered_count ? Math.round((campaignData.opened_count / campaignData.delivered_count) * 100) : 0;
  const clickRate = campaignData.opened_count ? Math.round((campaignData.clicked_count / campaignData.opened_count) * 100) : 0;

  return {
    insights: [
      `The campaign achieved a ${openRate}% open rate, showing a strong interest in the subject line.`,
      `The click-through rate relative to opens was ${clickRate}%, suggesting moderate alignment in body messaging.`,
      `A total of ${campaignData.conversion_count} conversions occurred, indicating functional campaign purchase triggers.`
    ],
    recommendations: [
      "Experiment with emojis in subject lines to increase baseline email opens.",
      "Add a clear, contrasting call-to-action button to improve body link click-through metrics.",
      "Follow up with customers who opened the email but did not click within 48 hours."
    ]
  };
}

module.exports = {
  generateSegmentRules,
  generateCampaignCopy,
  generateAnalyticsInsights
};
