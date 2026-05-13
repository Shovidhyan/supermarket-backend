const express = require('express');
const router = express.Router();
const bannerController = require('../controllers/banner-controller');
const authenticateToken = require('../middleware/authMiddleware');

// Public route for landing page
router.get('/', bannerController.getAllBanners);

// Admin protected routes
router.post('/add', authenticateToken, bannerController.addBanner);
router.delete('/:id', authenticateToken, bannerController.deleteBanner);

module.exports = router;
