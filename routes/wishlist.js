const express = require('express');
const router = express.Router();
const { sql } = require('../db');
const authenticateToken = require('../middleware/authMiddleware');

// GET: Fetch User's Wishlist
router.get('/', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        
        // Join Wishlist with Products and ProductDeals to get accurate pricing
        const result = await sql.query`
            SELECT 
                p.ProductID as id,
                p.Name as name,
                p.Price as originalPrice,
                COALESCE(pd.DealPrice, p.Price) as price,
                p.ImageURL as image_url,
                p.Category as category_name,
                p.Unit as unit,
                p.IsVeg as is_veg
            FROM Wishlist w
            JOIN Products p ON w.ProductID = p.ProductID
            LEFT JOIN ProductDeals pd ON p.ProductID = pd.ProductID 
                AND pd.IsActive = 1 
                AND pd.EndTime > GETUTCDATE()
            WHERE w.UserID = ${userId}
        `;

        res.json(result.recordset);
    } catch (err) {
        console.error("Get Wishlist Error:", err);
        res.status(500).json({ error: 'Failed to fetch wishlist' });
    }
});

// POST: Add to Wishlist
router.post('/add', authenticateToken, async (req, res) => {
    const { productId } = req.body;
    const userId = req.user.id;

    try {
        const pId = parseInt(productId);
        console.log(`Adding to Wishlist: User ${userId}, Product ${pId}`);
        
        // Check if already exists to prevent duplicates
        const check = await sql.query`
            SELECT * FROM Wishlist WHERE UserID = ${userId} AND ProductID = ${pId}
        `;

        if (check.recordset.length === 0) {
            await sql.query`
                INSERT INTO Wishlist (UserID, ProductID)
                VALUES (${userId}, ${pId})
            `;
            console.log('Successfully inserted into Wishlist');
        }
        
        res.json({ message: 'Added to wishlist' });
    } catch (err) {
        console.error("Add Wishlist Error:", err);
        res.status(500).json({ error: 'Failed to add item' });
    }
});

// DELETE: Remove from Wishlist
router.delete('/remove/:productId', authenticateToken, async (req, res) => {
    const { productId } = req.params;
    const userId = req.user.id;

    try {
        await sql.query`
            DELETE FROM Wishlist WHERE UserID = ${userId} AND ProductID = ${productId}
        `;
        res.json({ message: 'Removed from wishlist' });
    } catch (err) {
        console.error("Remove Wishlist Error:", err);
        res.status(500).json({ error: 'Failed to remove item' });
    }
});

module.exports = router;