const { sql } = require('../db');

const inventoryController = {
    // GET: Retrieve all inventory data joined with Products and Vendors
    getInventoryList: async (req, res) => {
        try {
            const result = await sql.query`
                SELECT 
                    p.ProductID, p.Name, p.Category, p.StockQuantity, p.Price AS SellingPrice, p.Unit, p.ImageURL,
                    i.Brand, i.MinStockLevel, i.CostPrice, i.RackNo, i.ExpiryDate, 
                    i.LastPurchaseDate, i.LastPurchasePrice, i.UpdatedAt,
                    v.VendorName AS SupplierName, v.VendorID
                FROM Products p
                LEFT JOIN Inventory i ON p.ProductID = i.ProductID
                LEFT JOIN Vendors v ON i.VendorID = v.VendorID
                WHERE p.IsActive = 1
                ORDER BY p.ProductID DESC
            `;
            res.json(result.recordset);
        } catch (err) {
            res.status(500).json({ error: 'Failed to fetch inventory list' });
        }
    },

    // POST: Save/Update Inventory Entry
    saveInventoryEntry: async (req, res) => {
        const { 
            productId, stockQuantity, minStockLevel, costPrice, 
            sellingPrice, brand, rackNo, expiryDate, vendorId 
        } = req.body;

        const transaction = new sql.Transaction();
        try {
            await transaction.begin();
            const request = new sql.Request(transaction);

            // 1. Update Core Product Table (Sync Stock and Price)
            await request
                .input('pid', sql.Int, productId)
                .input('stock', sql.Int, stockQuantity)
                .input('sPrice', sql.Decimal(10, 2), sellingPrice)
                .query(`UPDATE Products SET StockQuantity = @stock, Price = @sPrice WHERE ProductID = @pid`);

            // 2. Upsert Inventory Details
            await request
                .input('brand', sql.NVarChar, brand || null)
                .input('minQty', sql.Int, minStockLevel)
                .input('cost', sql.Decimal(10, 2), costPrice)
                .input('rack', sql.NVarChar, rackNo || null)
                .input('expiry', sql.Date, expiryDate || null)
                .input('vid', sql.Int, vendorId || null)
                .query(`
                    IF EXISTS (SELECT 1 FROM Inventory WHERE ProductID = @pid)
                    BEGIN
                        UPDATE Inventory SET 
                            Brand = @brand, MinStockLevel = @minQty, CostPrice = @cost, 
                            RackNo = @rack, ExpiryDate = @expiry, VendorID = @vid,
                            LastPurchasePrice = @cost, LastPurchaseDate = GETDATE(), UpdatedAt = GETDATE()
                        WHERE ProductID = @pid
                    END
                    ELSE
                    BEGIN
                        INSERT INTO Inventory (ProductID, Brand, MinStockLevel, CostPrice, SellingPrice, RackNo, ExpiryDate, VendorID, LastPurchasePrice, LastPurchaseDate)
                        VALUES (@pid, @brand, @minQty, @cost, @sPrice, @rack, @expiry, @vid, @cost, GETDATE())
                    END
                `);

            await transaction.commit();
            res.json({ message: "Inventory record saved successfully" });
        } catch (err) {
            if (transaction) await transaction.rollback();
            res.status(500).json({ error: "Failed to save inventory entry" });
        }
    }
};

module.exports = inventoryController;