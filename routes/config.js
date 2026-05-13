const express = require('express');
const router = express.Router();

// GET /api/config/razorpay-key
// Public endpoint to get the Razorpay Key ID for frontend use
router.get('/razorpay-key', (req, res) => {
    try {
        const keyId = process.env.RAZORPAY_KEY_ID;
        if (!keyId) {
            return res.status(500).json({ error: "Razorpay Key ID not configured on server" });
        }
        res.json({ keyId });
    } catch (error) {
        res.status(500).json({ error: "Internal Server Error" });
    }
});

module.exports = router;
