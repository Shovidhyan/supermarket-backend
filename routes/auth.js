const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { sql } = require('../db');
const admin = require('../firebaseAdmin');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.error('❌ JWT_SECRET is not defined in .env');
}


// REGISTER User
router.post('/register', async (req, res) => {
    const { fullName, email, password, phone } = req.body;

    try {
        const userCheck = await sql.query`SELECT * FROM Users WHERE Email = ${email}`;
        if (userCheck.recordset.length > 0) {
            return res.status(400).json({ message: 'User already exists' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const request = new sql.Request();
        request.input('FullName', sql.VarChar, fullName);
        request.input('Email', sql.VarChar, email);
        request.input('Phone', sql.VarChar, phone || null);
        request.input('PasswordHash', sql.VarChar, hashedPassword);

        await request.query(`
            INSERT INTO Users (FullName, Email, Phone, PasswordHash) 
            VALUES (@FullName, @Email, @Phone, @PasswordHash)
        `);

        res.status(201).json({ message: 'User registered successfully' });

    } catch (err) {
        console.error("Registration Error:", err);
        res.status(500).json({ error: 'Server error during registration' });
    }
});

// LOGIN User
router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        // 1. Find User
        console.log(`Login attempt for email: ${email}`);
        const result = await sql.query`SELECT * FROM Users WHERE Email = ${email}`;
        const user = result.recordset[0];

        if (!user) {
            console.log(`User not found: ${email}`);
            return res.status(400).json({ message: 'Invalid credentials' });
        }

        // 2. Check Password
        const isMatch = await bcrypt.compare(password, user.PasswordHash);
        if (!isMatch) {
            console.log(`Password mismatch for user: ${email}`);
            return res.status(400).json({ message: 'Invalid credentials' });
        }
        console.log(`Login successful for user: ${email}`);

        // 3. Process Avatar if it exists
        let avatarBase64 = null;
        if (user.AvatarData) {
            const base64String = Buffer.from(user.AvatarData).toString('base64');
            avatarBase64 = `data:image/jpeg;base64,${base64String}`;
        }

        // 4. Generate Token
        const token = jwt.sign(
            { id: user.UserID, email: user.Email, role: user.Role },
            JWT_SECRET,
            { expiresIn: '30d' }
        );

        // 5. Send Response
        res.json({
            token,
            user: {
                id: user.UserID,
                name: user.FullName,
                email: user.Email,
                phone: user.Phone,
                role: user.Role,
                avatar: avatarBase64
            }
        });

    } catch (err) {
        console.error("Login Error:", err);
        res.status(500).json({ error: 'Server error during login' });
    }
});

// GOOGLE LOGIN User
router.post('/google-login', async (req, res) => {
    const { idToken } = req.body;

    if (!idToken) {
        return res.status(400).json({ message: 'No ID token provided' });
    }

    try {
        console.log("Attempting to verify ID Token...");
        
        // 1. Verify token with Firebase Admin
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        const { email, name, picture } = decodedToken;

        if (!email) {
            return res.status(400).json({ message: 'Google account does not have an email' });
        }

        // 2. Check if user exists in SQL Database
        let result = await sql.query`SELECT * FROM Users WHERE Email = ${email}`;
        let user = result.recordset[0];

        // 3. If user doesn't exist, create a new one
        if (!user) {
            // Generate a random secure password hash to satisfy the DB constraint
            const randomPassword = crypto.randomBytes(32).toString('hex');
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(randomPassword, salt);

            // Set default FullName if not provided by Google
            const fullName = name || 'Google User';

            const request = new sql.Request();
            request.input('FullName', sql.VarChar, fullName);
            request.input('Email', sql.VarChar, email);
            request.input('PasswordHash', sql.VarChar, hashedPassword);
            // We can also store the picture as AvatarUrl if we want
            request.input('AvatarUrl', sql.NVarChar, picture || null);

            await request.query(`
                INSERT INTO Users (FullName, Email, PasswordHash, AvatarUrl) 
                VALUES (@FullName, @Email, @PasswordHash, @AvatarUrl)
            `);

            // Fetch the newly created user
            result = await sql.query`SELECT * FROM Users WHERE Email = ${email}`;
            user = result.recordset[0];
        }

        // 4. Process Avatar if it exists (from DB)
        let avatarBase64 = user.AvatarUrl; // Default to URL if available
        if (user.AvatarData) {
            const base64String = Buffer.from(user.AvatarData).toString('base64');
            avatarBase64 = `data:image/jpeg;base64,${base64String}`;
        }

        // 5. Generate JWT Token
        const token = jwt.sign(
            { id: user.UserID, email: user.Email, role: user.Role },
            JWT_SECRET,
            { expiresIn: '30d' }
        );

        // 6. Send Response
        res.json({
            token,
            user: {
                id: user.UserID,
                name: user.FullName,
                email: user.Email,
                phone: user.Phone,
                role: user.Role,
                avatar: avatarBase64
            }
        });

    } catch (err) {
        console.error("FULL Google Login Error:", err);
        res.status(500).json({ 
            error: 'Server error during Google login',
            message: err.message,
            code: err.code,
            details: process.env.NODE_ENV === 'development' ? err : undefined
        });
    }
});

module.exports = router;