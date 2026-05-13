const express = require('express');
const router = express.Router();
const { sql } = require('../db');

// GET All Categories
router.get('/', async (req, res) => {
    try {
        const result = await sql.query`SELECT * FROM Categories`;
        res.json(result.recordset);
    } catch (err) {
        console.error("Error fetching categories:", err);
        res.status(500).json({ error: 'Failed to fetch categories' });
    }
});

// POST Add New Category
router.post('/add', async (req, res) => {
    try {
        const { Name, Description, ImageUrl } = req.body;

        // 1. Basic Validation
        if (!Name) {
            return res.status(400).json({ message: "Category Name is required" });
        }

        // 2. Prepare the request
        const request = new sql.Request();
        
        // 3. Bind parameters (prevents SQL injection)
        request.input('Name', sql.NVarChar, Name);
        request.input('Description', sql.NVarChar, Description || null); // Handle optional fields
        request.input('ImageUrl', sql.NVarChar, ImageUrl || null);

        // 4. Execute Insert Query
        // We set ItemCount to 0 by default for new categories
        await request.query(`
            INSERT INTO Categories (Name, Description, ImageUrl, ItemCount)
            VALUES (@Name, @Description, @ImageUrl, 0)
        `);

        res.status(201).json({ message: "Category added successfully" });

    } catch (err) {
        console.error("Error adding category:", err);
        res.status(500).json({ error: 'Failed to add category' });
    }
});

module.exports = router;