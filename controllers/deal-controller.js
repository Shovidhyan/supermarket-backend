const { sql } = require('../db'); 

const dealController = {
    
    // 1. Create a New Deal
    createDeal: async (req, res) => {
        try {
            const { 
                productId, 
                originalPrice, 
                discountPercentage, 
                dealPrice, 
                durationHours 
            } = req.body;

            if (!productId || !durationHours || !dealPrice) {
                return res.status(400).json({ message: "Missing required fields." });
            }

            const request = new sql.Request();
            
            // FIX APPLIED HERE:
            // Changed GETDATE() to GETUTCDATE()
            // This stores the time in UTC. When the browser reads it, 
            // it will add +5:30 back, resulting in the correct local time.
            await request
                .input('ProductID', sql.Int, productId)
                .input('OriginalPrice', sql.Decimal(10, 2), originalPrice)
                .input('DiscountPercentage', sql.Decimal(5, 2), discountPercentage)
                .input('DealPrice', sql.Decimal(10, 2), dealPrice)
                .input('DurationHours', sql.Int, durationHours)
                .query(`
                    INSERT INTO ProductDeals 
                    (ProductID, OriginalPrice, DiscountPercentage, DealPrice, DurationHours, StartTime, EndTime, IsActive)
                    VALUES 
                    (
                        @ProductID, 
                        @OriginalPrice, 
                        @DiscountPercentage, 
                        @DealPrice, 
                        @DurationHours, 
                        GETUTCDATE(), -- Changed from GETDATE()
                        DATEADD(hour, @DurationHours, GETUTCDATE()), -- Changed from GETDATE()
                        1
                    )
                `);

            res.status(201).json({ message: "Deal created successfully!" });

        } catch (error) {
            console.error("Error creating deal:", error);
            res.status(500).json({ message: "Server error while creating deal." });
        }
    },

    // 2. Get Active Deals
    getActiveDeals: async (req, res) => {
        try {
            const request = new sql.Request();

            // IMPORTANT: Also update validation to use UTC
            await request.query(`
                UPDATE ProductDeals 
                SET IsActive = 0 
                WHERE EndTime < GETUTCDATE() AND IsActive = 1
            `);

            // Fetch deals using UTC comparison
            const result = await request.query(`
                SELECT 
                    pd.DealID,
                    pd.DealPrice,
                    pd.DiscountPercentage,
                    pd.DurationHours,
                    pd.EndTime,
                    p.Name as ProductName,
                    p.ImageURL,
                    p.Description,
                    p.Price as OriginalPrice,
                    p.ProductID
                FROM ProductDeals pd
                INNER JOIN Products p ON pd.ProductID = p.ProductID
                WHERE pd.EndTime > GETUTCDATE() AND pd.IsActive = 1
            `);
            
            res.status(200).json(result.recordset);
        } catch (error) {
            console.error("Error fetching deals:", error);
            res.status(500).json({ message: "Server error while fetching deals." });
        }
    },
    
    // ... rest of your controller (deleteDeal, etc.) remains the same
    deleteDeal: async (req, res) => {
        try {
            const { id } = req.params;
            const request = new sql.Request();
            await request.input('DealID', sql.Int, id).query(`
                DELETE FROM ProductDeals WHERE DealID = @DealID
            `);
            res.status(200).json({ message: "Deal deleted successfully!" });
        } catch (error) {
            res.status(500).json({ message: "Server error deleting deal." });
        }
    },

    getAllProducts: async (req, res) => {
        try {
            const request = new sql.Request();
            const result = await request.query(`
                SELECT ProductID, Name, Price FROM Products WHERE IsActive = 1
            `);
            res.status(200).json(result.recordset);
        } catch (error) {
            res.status(500).json({ message: "Server error fetching products" });
        }
    },

    getAllProductStocks: async (req, res) => {
        try {
            const request = new sql.Request();
            const result = await request.query(`
                SELECT ProductID, Name, CategoryID, Unit, 100 as StockQuantity, Category
                FROM Products WHERE IsActive = 1 ORDER BY ProductID DESC
            `);
            res.status(200).json(result.recordset);
        } catch (error) {
            res.status(500).json({ message: "Server error fetching product stocks" });
        }
    }
};

module.exports = dealController;