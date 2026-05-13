const express = require('express');
const router = express.Router();
const billingController = require('../controllers/billing-controller');

// Create a new GST bill
router.post('/create', billingController.createBill);

// Get all GST bills
router.get('/all', billingController.getBills);
router.get('/customer/:phone', billingController.getCustomerByPhone);

module.exports = router;
