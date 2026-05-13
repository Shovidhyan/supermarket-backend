const { sql } = require('../db');

const bannerController = {
    getAllBanners: async (req, res) => {
        try {
            const result = await sql.query(`
                SELECT b.*, c.Name as CategoryName 
                FROM Banners b
                JOIN Categories c ON b.CategoryID = c.CategoryID
                ORDER BY b.CreatedAt DESC
            `);
            res.json(result.recordset);
        } catch (err) {
            console.error("Error fetching banners:", err);
            res.status(500).json({ error: 'Failed to fetch banners' });
        }
    },

    addBanner: async (req, res) => {
        try {
            const { imageURL, categoryID, title, position } = req.body;
            
            if (!imageURL || !categoryID) {
                return res.status(400).json({ message: "Image URL and Category ID are required" });
            }

            const request = new sql.Request();
            request.input('ImageURL', sql.NVarChar(sql.MAX), imageURL);
            request.input('CategoryID', sql.Int, categoryID);
            request.input('Title', sql.NVarChar(255), title || null);
            request.input('Position', sql.NVarChar(50), position || 'top');

            await request.query(`
                INSERT INTO Banners (ImageURL, CategoryID, Title, Position)
                VALUES (@ImageURL, @CategoryID, @Title, @Position)
            `);

            res.status(201).json({ message: "Banner added successfully" });
        } catch (err) {
            console.error("Error adding banner:", err);
            res.status(500).json({ error: 'Failed to add banner', details: err.message });
        }
    },

    deleteBanner: async (req, res) => {
        try {
            const { id } = req.params;
            await sql.query`DELETE FROM Banners WHERE BannerID = ${id}`;
            res.json({ message: "Banner deleted successfully" });
        } catch (err) {
            console.error("Error deleting banner:", err);
            res.status(500).json({ error: 'Failed to delete banner' });
        }
    }
};

module.exports = bannerController;
