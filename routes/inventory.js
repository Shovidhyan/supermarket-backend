const express = require('express');
const router = express.Router();
const inventoryController = require('../controllers/inventory-controller');
const authenticateToken = require('../middleware/authMiddleware');

// Match the frontend calls:
// GET http://localhost:4000/api/inventory
router.get('/', authenticateToken, inventoryController.getInventoryList);

// POST http://localhost:4000/api/inventory/save
router.post('/save', authenticateToken, inventoryController.saveInventoryEntry);

module.exports = router;