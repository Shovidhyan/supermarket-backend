const express = require('express');
const router = express.Router();
const orderController = require('../controllers/order-controller'); 
const authenticateToken = require('../middleware/authMiddleware');

// User routes require general user authentication
router.use(authenticateToken); 

// --- User Routes ---
router.post('/create-razorpay-order', orderController.createRazorpayOrder);
router.post('/verify-payment', orderController.verifyAndPlaceOrder);
router.post('/place-cod', orderController.placeOrderCOD);
router.get('/my-orders', orderController.getMyOrders);
router.put('/cancel/:id', orderController.cancelOrder);

// --- NEW: Rewards Route ---
// Fetches points balance and transaction history for the logged-in user
router.get('/rewards/summary', orderController.getRewardsSummary);

// --- Admin Routes ---
// These routes handle administrative oversight and dashboard statistics
router.get('/admin/stats', orderController.getDashboardStats); 
router.get('/admin/all', orderController.getAllOrdersAdmin);
router.put('/admin/update/:id', orderController.updateOrderStatus);
router.get('/admin/details/:id', orderController.getAdminOrderDetails);

// --- NEW: OMS Panel Routes ---
router.get('/admin/oms', orderController.getOMSOrders);
router.put('/admin/oms/read-all', orderController.markAllAsRead);
router.put('/admin/oms/:id/read', orderController.markOrderAsRead);

// --- NEW: Picker Routes ---
router.get('/picker/:id', orderController.pickerGetOrderById);
router.put('/picker/process/:id', orderController.pickerProcessOrder);

// --- General Routes (Keep Last) ---
// Note: Placed last to avoid conflict with static paths like /rewards/summary
router.get('/:id', orderController.getOrderById);

module.exports = router;