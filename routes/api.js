const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');

// Configure upload folder dynamically
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
const upload = multer({ dest: uploadDir });

// Controllers
const customerController = require('../controllers/customerController');
const segmentController = require('../controllers/segmentController');
const campaignController = require('../controllers/campaignController');
const webhookController = require('../controllers/webhookController');

// Middlewares
const { validateSegmentAI, validateSegmentSave, validateCampaignSave } = require('../middlewares/validation');

// 1. Customers routes
router.post('/customers/import', upload.single('file'), customerController.importCustomers);
router.get('/customers', customerController.getCustomers);
router.get('/customers/:id', customerController.getCustomerById);

// 2. Segments routes
router.post('/segments/ai-generate', validateSegmentAI, segmentController.aiGenerateSegment);
router.post('/segments', validateSegmentSave, segmentController.createSegment);
router.get('/segments', segmentController.getSegments);
router.get('/segments/:id/customers', segmentController.getSegmentCustomers);

// 3. Campaigns routes
router.post('/campaigns', validateCampaignSave, campaignController.createCampaign);
router.post('/campaigns/ai-copywrite', campaignController.aiGenerateCopy);
router.post('/campaigns/:id/send', campaignController.sendCampaign);
router.get('/campaigns/:id/analytics', campaignController.getCampaignAnalytics);
router.post('/campaigns/:id/ai-insights', campaignController.getCampaignAIInsights);
router.get('/campaigns', campaignController.getCampaigns);

// 4. Webhooks callback route
router.post('/webhooks/channel-events', webhookController.handleChannelEvent);

module.exports = router;
