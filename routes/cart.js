const express = require('express');
const router = express.Router();
const { sql } = require('../db');
const authenticateToken = require('../middleware/authMiddleware');
const cartController = require('../controllers/cart-controller');

// Middleware
router.use(authenticateToken);

// --- Helper: Get or Create Cart for User ---
const getOrCreateCart = async (userId) => {
    let result = await sql.query`SELECT TOP 1 CartID FROM Cart WHERE UserID = ${userId}`;
    
    if (result.recordset.length > 0) {
        return result.recordset[0].CartID;
    }

    result = await sql.query`
        INSERT INTO Cart (UserID) OUTPUT INSERTED.CartID VALUES (${userId})
    `;
    return result.recordset[0].CartID;
};

// --- Summary Route ---
router.get('/summary', cartController.getCartSummary);

// GET: Fetch User's Cart with Deal Pricing
router.get('/', async (req, res) => {
    try {
        const userId = req.user.id;
        const cartId = await getOrCreateCart(userId);

        // Updated query to join with ProductDeals
        const result = await sql.query`
            SELECT 
                ci.CartItemID, 
                ci.ProductID, 
                ci.Quantity,
                p.Name, 
                COALESCE(pd.DealPrice, p.Price) AS Price, -- Use deal price if active
                p.Price AS OriginalPrice,
                p.ImageUrl, 
                p.Category, 
                p.Unit
            FROM CartItems ci
            JOIN Products p ON ci.ProductID = p.ProductID
            LEFT JOIN ProductDeals pd ON p.ProductID = pd.ProductID 
                AND pd.IsActive = 1 
                AND pd.EndTime > GETUTCDATE()
            WHERE ci.CartID = ${cartId}
        `;
        res.json(result.recordset);
    } catch (err) {
        console.error("Get Cart Error:", err);
        res.status(500).json({ error: 'Failed to fetch cart' });
    }
});

// POST: Add Item to Cart
router.post('/add', async (req, res) => {
    const { productId, quantity } = req.body;
    const userId = req.user.id;

    try {
        const cartId = await getOrCreateCart(userId);
        const qty = quantity || 1;

        const checkItem = await sql.query`
            SELECT * FROM CartItems WHERE CartID = ${cartId} AND ProductID = ${productId}
        `;

        if (checkItem.recordset.length > 0) {
            await sql.query`
                UPDATE CartItems 
                SET Quantity = Quantity + ${qty} 
                WHERE CartID = ${cartId} AND ProductID = ${productId}
            `;
        } else {
            await sql.query`
                INSERT INTO CartItems (CartID, ProductID, Quantity)
                VALUES (${cartId}, ${productId}, ${qty})
            `;
        }

        res.json({ message: 'Item added to cart' });
    } catch (err) {
        console.error("Add Cart Error:", err);
        res.status(500).json({ error: 'Failed to add item' });
    }
});

// ... (Update, Remove, and Clear routes remain same)
router.put('/update/:productId', async (req, res) => {
    const { productId } = req.params;
    const { quantity } = req.body;
    const userId = req.user.id;
    try {
        const cartId = await getOrCreateCart(userId);
        if (quantity <= 0) {
            await sql.query`DELETE FROM CartItems WHERE CartID = ${cartId} AND ProductID = ${productId}`;
        } else {
            await sql.query`UPDATE CartItems SET Quantity = ${quantity} WHERE CartID = ${cartId} AND ProductID = ${productId}`;
        }
        res.json({ message: 'Cart updated' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update cart' });
    }
});

router.delete('/remove/:productId', async (req, res) => {
    const { productId } = req.params;
    const userId = req.user.id;
    try {
        const cartId = await getOrCreateCart(userId);
        await sql.query`DELETE FROM CartItems WHERE CartID = ${cartId} AND ProductID = ${productId}`;
        res.json({ message: 'Item removed' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to remove item' });
    }
});

router.delete('/clear', async (req, res) => {
    const userId = req.user.id;
    try {
        const cartId = await getOrCreateCart(userId);
        await sql.query`DELETE FROM CartItems WHERE CartID = ${cartId}`;
        res.json({ message: 'Cart cleared' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to clear cart' });
    }
});

module.exports = router;