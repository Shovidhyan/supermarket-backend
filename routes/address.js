const express = require('express');
const router = express.Router();
const { sql } = require('../db'); 
const authenticateToken = require('../middleware/authMiddleware');

// --- NEW: Get Default Address ---
router.get('/default', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const result = await sql.query`
            SELECT TOP 1 
                AddressID, FullAddress, City, State, Pincode, Landmark, IsDefault, PrimaryPhone, AlternatePhone 
            FROM Addresses 
            WHERE UserID = ${userId} AND IsDefault = 1 AND IsActive = 1
        `;
        // Return object if found, else empty object (to avoid frontend crash)
        res.json(result.recordset.length > 0 ? result.recordset[0] : {});
    } catch (err) {
        console.error("Get Default Address Error:", err);
        res.status(500).json({ error: 'Failed to fetch default address' });
    }
});

// GET: Fetch All Active Addresses
router.get('/', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const result = await sql.query`
            SELECT AddressID, FullAddress, City, State, Pincode, Landmark, IsDefault, PrimaryPhone, AlternatePhone 
            FROM Addresses 
            WHERE UserID = ${userId} AND IsActive = 1
            ORDER BY IsDefault DESC, CreatedAt DESC
        `;
        res.json(result.recordset);
    } catch (err) {
        console.error("Get Addresses Error:", err);
        res.status(500).json({ error: 'Failed to fetch addresses' });
    }
});

// POST: Add New Address
router.post('/add', authenticateToken, async (req, res) => {
    const { fullAddress, city, state, pincode, landmark, isDefault, primaryPhone, alternatePhone } = req.body;
    const userId = req.user.id;

    try {
        const request = new sql.Request();
        request.input('UserId', sql.Int, userId);
        request.input('FullAddress', sql.NVarChar, fullAddress);
        request.input('City', sql.NVarChar, city);
        request.input('State', sql.NVarChar, state);
        request.input('Pincode', sql.NVarChar, pincode);
        request.input('Landmark', sql.NVarChar, landmark);
        request.input('IsDefault', sql.Bit, isDefault ? 1 : 0);
        request.input('PrimaryPhone', sql.NVarChar, primaryPhone); 
        request.input('AlternatePhone', sql.NVarChar, alternatePhone);

        if (isDefault) {
            await request.query(`UPDATE Addresses SET IsDefault = 0 WHERE UserID = @UserId`);
        }

        await request.query(`
            INSERT INTO Addresses (UserID, FullAddress, City, State, Pincode, Landmark, IsDefault, PrimaryPhone, AlternatePhone, IsActive)
            VALUES (@UserId, @FullAddress, @City, @State, @Pincode, @Landmark, @IsDefault, @PrimaryPhone, @AlternatePhone, 1)
        `);

        res.json({ message: 'Address added successfully' });
    } catch (err) {
        console.error("Add Address Error:", err);
        res.status(500).json({ error: 'Failed to add address' });
    }
});

// ... (Rest of PUT/DELETE logic remains same as previous steps) ...
// Ensure you keep the 'set-default' and 'delete' logic we added before!

// PUT: Set Default
router.put('/set-default/:id', authenticateToken, async (req, res) => {
    const addressId = req.params.id;
    const userId = req.user.id;
    try {
        const request = new sql.Request();
        request.input('AddressId', sql.Int, addressId);
        request.input('UserId', sql.Int, userId);
        await request.query(`
            UPDATE Addresses SET IsDefault = 0 WHERE UserID = @UserId;
            UPDATE Addresses SET IsDefault = 1 WHERE AddressID = @AddressId AND UserID = @UserId;
        `);
        res.json({ message: 'Default address updated successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to set default address' });
    }
});

// DELETE: Soft Delete
router.delete('/remove/:id', authenticateToken, async (req, res) => {
    const addressId = req.params.id;
    const userId = req.user.id;
    try {
        await sql.query`UPDATE Addresses SET IsActive = 0 WHERE AddressID = ${addressId} AND UserID = ${userId}`;
        res.json({ message: 'Address removed successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete address' });
    }
});

module.exports = router;