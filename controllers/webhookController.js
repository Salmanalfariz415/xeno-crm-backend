const db = require('../config/database');

/**
 * Handle incoming delivery/engagement webhooks from Channel Service.
 * Updates log status and updates analytics totals.
 */
async function handleChannelEvent(req, res) {
  try {
    const { external_message_id, status } = req.body;

    if (!external_message_id || !status) {
      return res.status(400).json({ success: false, error: 'Missing external_message_id or status' });
    }

    console.log(`Received webhook event: Message ID ${external_message_id} -> ${status}`);

    // 1. Find the campaign log entry
    const logEntry = await db('campaign_logs').where('external_message_id', external_message_id).first();
    if (!logEntry) {
      return res.status(404).json({ success: false, error: 'Message log not found' });
    }

    const campaignId = logEntry.campaign_id;

    // 2. Update log status (only advance status, e.g. don't overwrite 'clicked' back to 'delivered' if received out of order)
    const statusPriority = {
      'pending': 0,
      'sent': 1,
      'failed': 2,
      'delivered': 3,
      'opened': 4,
      'read': 5,
      'clicked': 6
    };

    const currentPriority = statusPriority[logEntry.status] || 0;
    const incomingPriority = statusPriority[status] || 0;

    if (incomingPriority > currentPriority) {
      await db('campaign_logs')
        .where('external_message_id', external_message_id)
        .update({ status, updated_at: new Date() });
    }

    // 3. Recalculate campaign analytics counts dynamically to ensure exact totals consistency
    const statusCounts = await db('campaign_logs')
      .where('campaign_id', campaignId)
      .select('status')
      .count('id as count')
      .groupBy('status');

    const counts = {
      sent: 0,
      delivered: 0,
      failed: 0,
      opened: 0,
      read: 0,
      clicked: 0
    };

    statusCounts.forEach(row => {
      // Aggregate counters: a message in 'opened' state was also 'delivered' and 'sent'.
      // However, we want campaign_analytics to track funnel steps.
      // Funnel definitions:
      // - sent_count: any log with status NOT 'pending'
      // - delivered_count: status is in ['delivered', 'opened', 'read', 'clicked']
      // - failed_count: status is 'failed'
      // - opened_count: status is in ['opened', 'read', 'clicked']
      // - read_count: status is in ['read', 'clicked']
      // - clicked_count: status is 'clicked'
      const statusStr = row.status;
      const countVal = parseInt(row.count);

      if (statusStr !== 'pending') {
        counts.sent += countVal;
      }
      if (statusStr === 'failed') {
        counts.failed += countVal;
      }
      if (['delivered', 'opened', 'read', 'clicked'].includes(statusStr)) {
        counts.delivered += countVal;
      }
      if (['opened', 'read', 'clicked'].includes(statusStr)) {
        counts.opened += countVal;
      }
      if (['read', 'clicked'].includes(statusStr)) {
        counts.read += countVal;
      }
      if (statusStr === 'clicked') {
        counts.clicked += countVal;
      }
    });

    // Update analytics summary row
    await db('campaign_analytics')
      .where('campaign_id', campaignId)
      .update({
        sent_count: counts.sent,
        delivered_count: counts.delivered,
        failed_count: counts.failed,
        opened_count: counts.opened,
        read_count: counts.read,
        clicked_count: counts.clicked,
        updated_at: new Date()
      });

    res.json({
      success: true,
      message: 'Log status updated',
      updatedStatus: incomingPriority > currentPriority ? status : logEntry.status
    });
  } catch (err) {
    console.error('Error in handleChannelEvent:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = {
  handleChannelEvent
};
