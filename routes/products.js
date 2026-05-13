const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload'); // The fixed middleware
const productController = require('../controllers/product-controller');

// GET /api/products
router.get('/', productController.getAllProducts); 

// POST /api/products/add
router.post('/add', upload.single('productImage'), productController.addNewProduct);

// PUT /api/products/update/:id
router.put('/update/:id', upload.single('productImage'), productController.updateProduct);

// DELETE /api/products/delete/:id
router.delete('/delete/:id', productController.deleteProduct);

// GET /api/products/barcode/:barcode  — MUST be before /:id to avoid wildcard conflict
router.get('/barcode/:barcode', productController.getProductByBarcode);

// GET /api/products/:id 
router.get('/:id', productController.getProductById);

module.exports = router;