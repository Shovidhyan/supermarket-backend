const express = require('express');
const router = express.Router();
const { sql } = require('../db');
const authenticateToken = require('../middleware/authMiddleware');
const memoryUpload = require('../middleware/memoryUpload'); // Use the NEW memory middleware

// GET: Fetch Current User Profile
router.get('/', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        
        // Fetch User and Stats in one go or separate queries
        const userResult = await sql.query`
            SELECT UserID, FullName, Email, Phone, Role, Address, City, State, ZipCode, Country, AvatarData 
            FROM Users 
            WHERE UserID = ${userId}
        `;

        const orderCountResult = await sql.query`SELECT COUNT(*) as OrderCount FROM Orders WHERE UserID = ${userId}`;
        const pointsResult = await sql.query`SELECT ISNULL(TotalPoints, 0) as Points FROM RewardBalances WHERE UserID = ${userId}`;
        const wishlistCountResult = await sql.query`SELECT COUNT(*) as WishlistCount FROM Wishlist WHERE UserID = ${userId}`;

        if (userResult.recordset.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }

        const user = userResult.recordset[0];

        // Convert Binary Data to Base64 String for Frontend
        let avatarBase64 = null;
        if (user.AvatarData) {
            const base64String = Buffer.from(user.AvatarData).toString('base64');
            avatarBase64 = `data:image/jpeg;base64,${base64String}`;
        }

        res.json({
            ...user,
            OrderCount: orderCountResult.recordset[0]?.OrderCount || 0,
            Points: pointsResult.recordset[0]?.Points || 0,
            TotalSavings: wishlistCountResult.recordset[0]?.WishlistCount || 0,
            AvatarUrl: avatarBase64,
            AvatarData: undefined
        });

    } catch (err) {
        console.error("Get Profile Error:", err);
        res.status(500).json({ error: 'Failed to fetch profile' });
    }
});

// PUT: Update Profile (Stores Image in DB)
router.put('/update', authenticateToken, memoryUpload.single('avatar'), async (req, res) => {
    const userId = req.user.id;
    const { fullName, phone, address, city, state, zipCode, country, syncAddress } = req.body;

    let transaction;
    try {
        transaction = new sql.Transaction(req.db);
        await transaction.begin();
        const request = new sql.Request(transaction);

        // 1. Prepare Update Query
        // We only update AvatarData if a new file was uploaded
        let avatarSqlPart = "";
        if (req.file) {
            request.input('AvatarData', sql.VarBinary(sql.MAX), req.file.buffer);
            avatarSqlPart = ", AvatarData = @AvatarData";
        }

        // 2. Update Users Table
        await request
            .input('UserID', sql.Int, userId)
            .input('FullName', sql.NVarChar, fullName)
            .input('Phone', sql.VarChar, phone)
            .input('Address', sql.NVarChar, address)
            .input('City', sql.NVarChar, city)
            .input('State', sql.NVarChar, state)
            .input('ZipCode', sql.VarChar, zipCode)
            .input('Country', sql.NVarChar, country)
            .query(`
                UPDATE Users 
                SET FullName = @FullName, 
                    Phone = @Phone,
                    Address = @Address,
                    City = @City,
                    State = @State,
                    ZipCode = @ZipCode,
                    Country = @Country
                    ${avatarSqlPart} -- Only updates image if provided
                WHERE UserID = @UserID
            `);

        // 3. Sync Default Address (Same logic as before)
        if (syncAddress === 'true') {
            const checkRes = await new sql.Request(transaction)
                .query(`SELECT AddressID FROM Addresses WHERE UserID = ${userId} AND IsDefault = 1`);

            if (checkRes.recordset.length > 0) {
                await new sql.Request(transaction)
                    .input('FullAddress', sql.NVarChar, address)
                    .input('City', sql.NVarChar, city)
                    .input('State', sql.NVarChar, state)
                    .input('Pincode', sql.NVarChar, zipCode)
                    .input('PrimaryPhone', sql.NVarChar, phone)
                    .query(`
                        UPDATE Addresses SET 
                            FullAddress = @FullAddress, City = @City, State = @State, 
                            Pincode = @Pincode, PrimaryPhone = @PrimaryPhone
                        WHERE UserID = ${userId} AND IsDefault = 1
                    `);
            } else {
                await new sql.Request(transaction)
                    .input('FullAddress', sql.NVarChar, address)
                    .input('City', sql.NVarChar, city)
                    .input('State', sql.NVarChar, state)
                    .input('Pincode', sql.NVarChar, zipCode)
                    .input('PrimaryPhone', sql.NVarChar, phone)
                    .query(`
                        INSERT INTO Addresses (UserID, FullAddress, City, State, Pincode, IsDefault, IsActive, PrimaryPhone)
                        VALUES (${userId}, @FullAddress, @City, @State, @Pincode, 1, 1, @PrimaryPhone)
                    `);
            }
        }

        await transaction.commit();

        // Return Base64 image immediately so UI updates without refresh
        let newAvatarBase64 = req.body.avatarUrl; // fallback
        if (req.file) {
            newAvatarBase64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
        }

        res.json({
            message: 'Profile updated successfully',
            avatarUrl: newAvatarBase64
        });

    } catch (err) {
        if (transaction) await transaction.rollback();
        console.error("Update Profile Error:", err);
        res.status(500).json({ error: 'Failed to update profile' });
    }
});

// PATCH: Update Phone Number only
router.patch('/phone', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    const { phone } = req.body;

    if (!phone) {
        return res.status(400).json({ message: "Phone number is required." });
    }

    try {
        await sql.query`
            UPDATE Users 
            SET Phone = ${phone}
            WHERE UserID = ${userId}
        `;
        res.json({ message: "Phone number updated successfully" });
    } catch (err) {
        console.error("Update Phone Error:", err);
        res.status(500).json({ error: 'Failed to update phone number' });
    }
});

module.exports = router;