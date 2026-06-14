const db = require('../config/database');
const aiService = require('../services/aiService');
const axios = require('axios');
require('dotenv').config();

/**
 * Helper to interpolate handlebars templates with customer data.
 */
function parseTemplate(template, customer) {
  let output = template;
  output = output.replace(/\{\{first_name\}\}/gi, customer.first_name || '');
  output = output.replace(/\{\{last_name\}\}/gi, customer.last_name || '');
  output = output.replace(/\{\{location\}\}/gi, customer.location || '');
  
  // Support parsing customer attributes keys directly
  const attrs = customer.attributes 
    ? (typeof customer.attributes === 'string' ? JSON.parse(customer.attributes) : customer.attributes)
    : {};
  
  Object.keys(attrs).forEach(key => {
    const val = Array.isArray(attrs[key]) ? attrs[key].join(', ') : attrs[key];
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'gi');
    output = output.replace(regex, val || '');
    
    const attrPrefixRegex = new RegExp(`\\{\\{attributes\\.${key}\\}\\}`, 'gi');
    output = output.replace(attrPrefixRegex, val || '');
  });

  return output;
}

/**
 * Create a new Campaign.
 */
async function createCampaign(req, res) {
  try {
    const { name, segment_id, subject_line, message_template, ai_prompt } = req.body;

    if (!name || !segment_id || !subject_line || !message_template) {
      return res.status(400).json({ success: false, error: 'Missing required campaign parameters' });
    }

    const [id] = await db('campaigns').insert({
      name,
      segment_id,
      subject_line,
      message_template,
      ai_prompt,
      status: 'draft'
    });

    // Create entry in campaign_analytics
    await db('campaign_analytics').insert({
      campaign_id: id,
      sent_count: 0,
      delivered_count: 0,
      failed_count: 0,
      opened_count: 0,
      read_count: 0,
      clicked_count: 0,
      conversion_count: 0
    });

    res.status(201).json({
      success: true,
      campaign: { id, name, status: 'draft' }
    });
  } catch (err) {
    console.error('Error in createCampaign:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * Generate AI message copy variations.
 */
async function aiGenerateCopy(req, res) {
  try {
    const { prompt, segmentId, tone } = req.body;
    if (!prompt || !segmentId) {
      return res.status(400).json({ success: false, error: 'Prompt and Segment ID are required' });
    }

    const segment = await db('segments').where('id', segmentId).first();
    if (!segment) {
      return res.status(404).json({ success: false, error: 'Segment not found' });
    }

    const variations = await aiService.generateCampaignCopy(prompt, segment.name, tone || 'excited');
    res.json({ success: true, variations });
  } catch (err) {
    console.error('Error in aiGenerateCopy:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * Send Campaign.
 * Fetches target audience, personalizes templates, inserts log entries, 
 * and POSTs message batch to Channel Service.
 */
async function sendCampaign(req, res) {
  try {
    const { id } = req.params;
    const campaign = await db('campaigns').where('id', id).first();
    if (!campaign) {
      return res.status(404).json({ success: false, error: 'Campaign not found' });
    }

    const segment = await db('segments').where('id', campaign.segment_id).first();
    if (!segment) {
      return res.status(404).json({ success: false, error: 'Target segment not found for this campaign' });
    }

    const sqlParams = segment.sql_params 
      ? (typeof segment.sql_params === 'string' ? JSON.parse(segment.sql_params) : segment.sql_params)
      : [];

    // 1. Fetch matching customers
    const [matchingRows] = await db.raw(segment.sql_query, sqlParams);
    if (!matchingRows || matchingRows.length === 0) {
      return res.status(400).json({ success: false, error: 'Target segment is empty. No recipients to send to.' });
    }

    const customerIds = matchingRows.map(r => r.id);
    const customers = await db('customers').whereIn('id', customerIds);

    // 2. Personalize templates and prepare records
    const logsToInsert = [];
    customers.forEach(customer => {
      const parsedBody = parseTemplate(campaign.message_template, customer);
      const parsedSubject = parseTemplate(campaign.subject_line, customer);
      
      logsToInsert.push({
        campaign_id: campaign.id,
        customer_id: customer.id,
        message_body: parsedBody,
        status: 'pending'
      });
    });

    // Write campaign status to 'sending'
    await db('campaigns').where('id', campaign.id).update({ status: 'sending' });

    // Use transaction to insert base logs
    const crmLogIds = [];
    await db.transaction(async trx => {
      // Clear any previous send logs for this campaign to allow retries
      await trx('campaign_logs').where('campaign_id', campaign.id).del();
      
      for (const log of logsToInsert) {
        const [logId] = await trx('campaign_logs').insert(log);
        crmLogIds.push({
          crm_log_id: logId,
          recipient_email: customers.find(c => c.id === log.customer_id).email,
          subject: campaign.subject_line,
          body: log.message_body
        });
      }
    });

    // 3. Dispatch to Channel Service
    const channelServiceUrl = process.env.CHANNEL_SERVICE_URL || 'http://localhost:5001/api/channel/send-batch';
    const webhookUrl = process.env.CRM_WEBHOOK_URL || 'http://localhost:5000/api/webhooks/channel-events';

    console.log(`Sending batch of ${crmLogIds.length} messages to Channel Service: ${channelServiceUrl}`);
    
    let channelResponse;
    try {
      channelResponse = await axios.post(channelServiceUrl, {
        webhook_url: webhookUrl,
        messages: crmLogIds
      });
    } catch (apiErr) {
      console.error('Failed to communicate with Channel Service:', apiErr.message);
      // Revert status to draft
      await db('campaigns').where('id', campaign.id).update({ status: 'draft' });
      return res.status(502).json({ 
        success: false, 
        error: `Channel Service Communication Failure: ${apiErr.message}. Ensure the Channel Service is running on port 5001.` 
      });
    }

    const { dispatches } = channelResponse.data;

    // 4. Update campaign logs with External Message IDs and status 'sent'
    await db.transaction(async trx => {
      for (const item of dispatches) {
        await trx('campaign_logs')
          .where('id', item.crm_log_id)
          .update({
            external_message_id: item.external_message_id,
            status: 'sent',
            sent_at: new Date()
          });
      }
      
      // Reset analytics counts
      await trx('campaign_analytics')
        .where('campaign_id', campaign.id)
        .update({
          sent_count: dispatches.length,
          delivered_count: 0,
          failed_count: 0,
          opened_count: 0,
          read_count: 0,
          clicked_count: 0,
          conversion_count: 0
        });
    });

    // Mark campaign as 'completed'
    await db('campaigns').where('id', campaign.id).update({ status: 'completed' });

    res.json({
      success: true,
      message: 'Campaign sent successfully',
      sentCount: dispatches.length
    });
  } catch (err) {
    console.error('Error in sendCampaign:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * Get Campaign Analytics.
 */
async function getCampaignAnalytics(req, res) {
  try {
    const { id } = req.params;
    const campaign = await db('campaigns').where('id', id).first();
    if (!campaign) {
      return res.status(404).json({ success: false, error: 'Campaign not found' });
    }

    const analytics = await db('campaign_analytics').where('campaign_id', id).first();
    const logsCount = await db('campaign_logs')
      .where('campaign_id', id)
      .select('status')
      .count('id as count')
      .groupBy('status');

    // Compile dynamic status breakdown
    const statusBreakdown = {
      pending: 0,
      sent: 0,
      delivered: 0,
      failed: 0,
      opened: 0,
      read: 0,
      clicked: 0
    };
    logsCount.forEach(row => {
      statusBreakdown[row.status] = row.count;
    });

    // Check conversions (customers who placed orders within 7 days after campaign sent_at)
    // Query campaign sent logs that were clicked
    const clicks = await db('campaign_logs')
      .where('campaign_id', id)
      .whereIn('status', ['clicked'])
      .select('customer_id', 'sent_at');

    let conversionCount = 0;
    for (const click of clicks) {
      if (!click.sent_at) continue;
      const sentTime = new Date(click.sent_at);
      const limitTime = new Date(sentTime.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days window

      const postClickOrder = await db('orders')
        .where('customer_id', click.customer_id)
        .whereBetween('order_date', [sentTime, limitTime])
        .first();

      if (postClickOrder) {
        conversionCount++;
      }
    }

    // Update aggregate conversion counts
    await db('campaign_analytics')
      .where('campaign_id', id)
      .update({ conversion_count: conversionCount });

    // Calculate rates
    const totalDelivered = analytics.delivered_count || statusBreakdown.delivered || 0;
    const totalSent = analytics.sent_count || 0;
    const totalOpened = analytics.opened_count || 0;
    const totalClicked = analytics.clicked_count || 0;

    const conversionRate = totalSent > 0 ? parseFloat(((conversionCount / totalSent) * 100).toFixed(2)) : 0.00;

    res.json({
      success: true,
      campaignName: campaign.name,
      analytics: {
        sent: totalSent,
        delivered: totalDelivered,
        failed: analytics.failed_count || statusBreakdown.failed || 0,
        opened: totalOpened,
        read: analytics.read_count || statusBreakdown.read || 0,
        clicked: totalClicked,
        converted: conversionCount,
        conversion_rate: conversionRate
      },
      statusBreakdown
    });
  } catch (err) {
    console.error('Error in getCampaignAnalytics:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * Generate AI insights based on campaign metrics.
 */
async function getCampaignAIInsights(req, res) {
  try {
    const { id } = req.params;
    const campaign = await db('campaigns').where('id', id).first();
    if (!campaign) {
      return res.status(404).json({ success: false, error: 'Campaign not found' });
    }

    const segment = await db('segments').where('id', campaign.segment_id).first();
    const analytics = await db('campaign_analytics').where('campaign_id', id).first();
    
    if (!analytics || analytics.sent_count === 0) {
      return res.status(400).json({ success: false, error: 'No analytics available. Trigger campaign sending first.' });
    }

    const conversionRate = analytics.sent_count > 0 ? ((analytics.conversion_count / analytics.sent_count) * 100).toFixed(2) : 0;

    const payload = {
      name: campaign.name,
      segment_name: segment ? segment.name : 'Unknown Segment',
      sent_count: analytics.sent_count,
      delivered_count: analytics.delivered_count,
      failed_count: analytics.failed_count,
      opened_count: analytics.opened_count,
      read_count: analytics.read_count,
      clicked_count: analytics.clicked_count,
      conversion_count: analytics.conversion_count,
      conversion_rate: conversionRate
    };

    const insights = await aiService.generateAnalyticsInsights(payload);
    res.json({ success: true, insights });
  } catch (err) {
    console.error('Error in getCampaignAIInsights:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * List Campaigns.
 */
async function getCampaigns(req, res) {
  try {
    const campaigns = await db('campaigns')
      .join('segments', 'campaigns.segment_id', 'segments.id')
      .select(
        'campaigns.id',
        'campaigns.name',
        'campaigns.subject_line',
        'campaigns.status',
        'campaigns.created_at',
        'segments.name as segment_name'
      )
      .orderBy('campaigns.created_at', 'desc');

    res.json({ success: true, campaigns });
  } catch (err) {
    console.error('Error in getCampaigns:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = {
  createCampaign,
  aiGenerateCopy,
  sendCampaign,
  getCampaignAnalytics,
  getCampaignAIInsights,
  getCampaigns
};
