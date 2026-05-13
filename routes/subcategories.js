const express = require('express');
const router = express.Router();
const { sql } = require('../db');

// GET All SubCategories
router.get('/', async (req, res) => {
    try {
        const result = await sql.query`SELECT * FROM SubCategories`;
        res.json(result.recordset);
    } catch (err) {
        console.error("Error fetching subcategories:", err);
        res.status(500).json({ error: 'Failed to fetch subcategories' });
    }
});

// GET SubCategories by CategoryID
router.get('/:categoryId', async (req, res) => {
    try {
        const { categoryId } = req.params;
        const result = await sql.query`SELECT * FROM SubCategories WHERE CategoryID = ${categoryId}`;
        res.json(result.recordset);
    } catch (err) {
        console.error("Error fetching subcategories by category:", err);
        res.status(500).json({ error: 'Failed to fetch subcategories' });
    }
});

// POST Add New SubCategory
router.post('/add', async (req, res) => {
    try {
        const { CategoryID, Name, Description, ImageUrl } = req.body;

        if (!CategoryID || !Name) {
            return res.status(400).json({ message: "CategoryID and Name are required" });
        }

        const request = new sql.Request();
        
        request.input('CategoryID', sql.Int, parseInt(CategoryID));
        request.input('Name', sql.NVarChar, Name);
        request.input('Description', sql.NVarChar, Description || null);
        request.input('ImageUrl', sql.NVarChar, ImageUrl || null);

        await request.query(`
            INSERT INTO SubCategories (CategoryID, Name, Description, ImageUrl)
            VALUES (@CategoryID, @Name, @Description, @ImageUrl)
        `);

        res.status(201).json({ message: "SubCategory added successfully" });

    } catch (err) {
        console.error("Error adding subcategory:", err);
        res.status(500).json({ error: 'Failed to add subcategory' });
    }
});

module.exports = router;
