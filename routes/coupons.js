const express = require('express');
const router = express.Router();
const { sql } = require('../db');
const authenticateToken = require('../middleware/authMiddleware');

// --- HELPER: Auto-expire coupons ---
// This runs before fetching data to ensure the DB status matches reality
async function expireOldCoupons() {
    try {
        await sql.query`
            UPDATE Coupons 
            SET IsActive = 0 
            WHERE IsActive = 1 
            AND ExpiryDate <= GETUTCDATE()
        `;
    } catch (err) {
        console.error("Auto-expire error:", err);
    }
}

// --- USER: Get Active Coupons ---
// Used by Cart to show valid deals
router.get('/active', authenticateToken, async (req, res) => {
    try {
        // 1. Mark expired coupons as inactive first
        await expireOldCoupons();

        // 2. Fetch only valid active coupons
        const result = await sql.query`
            SELECT CouponID, Code, DiscountPercentage, ExpiryDate 
            FROM Coupons 
            WHERE IsActive = 1 
            ORDER BY CreatedAt DESC`;
        
        res.json(result.recordset);
    } catch (err) {
        console.error("Fetch Active Coupons Error:", err);
        res.status(500).json({ error: "Failed to fetch coupons" });
    }
});

// --- NEW: Scratch Deal (Random Coupon) ---
router.get('/scratch', authenticateToken, async (req, res) => {
    try {
        await expireOldCoupons();
        const result = await sql.query`
            SELECT TOP 1 CouponID, Code, DiscountPercentage 
            FROM Coupons 
            WHERE IsActive = 1 
            ORDER BY NEWID()`; // Random selection
        
        if (result.recordset.length > 0) {
            res.json(result.recordset[0]);
        } else {
            res.json({ message: "Better luck next time!" });
        }
    } catch (err) {
        console.error("Scratch Deal Error:", err);
        res.status(500).json({ error: "Failed to fetch scratch deal" });
    }
});

// --- ADMIN: Create Coupon ---
router.post('/create', authenticateToken, async (req, res) => {
    const { code, discount, hoursActive } = req.body;
    
    // Basic validation
    if (!code || !discount) {
        return res.status(400).json({ error: "Code and discount are required" });
    }

    try {
        await sql.query`
            INSERT INTO Coupons (Code, DiscountPercentage, IsActive, CreatedAt, ExpiryDate) 
            VALUES (
                ${code.toUpperCase().trim()}, 
                ${parseInt(discount)}, 
                1, 
                GETUTCDATE(), 
                DATEADD(hour, ${parseInt(hoursActive) || 24}, GETUTCDATE())
            )
        `;
        res.status(201).json({ message: "Coupon created successfully" });
    } catch (err) {
        // Handle SQL Server Unique Constraint Violation (Error 2627)
        if (err.number === 2627) {
            return res.status(409).json({ error: `Coupon code '${code}' already exists.` });
        }
        
        console.error("Create Coupon Error:", err);
        res.status(500).json({ error: "Failed to create coupon" });
    }
});

// --- ADMIN: Get All Active ---
// Only returns coupons that are IsActive = 1
router.get('/admin/all', authenticateToken, async (req, res) => {
    try {
        // 1. Mark expired coupons as inactive first
        await expireOldCoupons();

        // 2. Fetch only Active coupons
        const result = await sql.query`
            SELECT CouponID, Code, DiscountPercentage, ExpiryDate 
            FROM Coupons 
            WHERE IsActive = 1 
            ORDER BY CreatedAt DESC`;
            
        res.json(result.recordset);
    } catch (err) {
        console.error("Fetch Admin Coupons Error:", err);
        res.status(500).json({ error: "Failed to fetch coupons" });
    }
});

// --- ADMIN: Deactivate Coupon ---
router.delete('/delete/:id', authenticateToken, async (req, res) => {
    try {
        // Sets IsActive to 0 (Soft Delete)
        await sql.query`UPDATE Coupons SET IsActive = 0 WHERE CouponID = ${req.params.id}`;
        res.json({ message: "Coupon deactivated" });
    } catch (err) {
        res.status(500).json({ error: "Delete failed" });
    }
});

module.exports = router;