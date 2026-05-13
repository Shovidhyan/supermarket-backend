const { sql } = require('../db');

const productController = {
    
    // --- 1. Add New Product ---
    addNewProduct: async (req, res) => {
        try {
            const { name, description, price, unit, categoryId, subCategoryId, isVeg, stock, barcode, imageUrlLink } = req.body;

            
            let imageUrl = null;
            if (req.file) imageUrl = `uploads/${req.file.filename}`;
            else if (imageUrlLink) imageUrl = imageUrlLink;
            
            if (!name || !price || !unit || !categoryId || !imageUrl || !barcode) {
                return res.status(400).json({ message: "Missing required fields, including Barcode." });
            }


            const isVegBit = (isVeg === 'true' || isVeg === true) ? 1 : 0;
            const catIdInt = parseInt(categoryId);

            const request = new sql.Request();

            // Fetch Category Name for denormalization
            const catResult = await request.query(`SELECT Name FROM Categories WHERE CategoryID = ${catIdInt}`);
            const categoryName = catResult.recordset[0] ? catResult.recordset[0].Name : 'Unknown';

            // Fetch SubCategory Name if provided
            const subCatIdInt = subCategoryId && subCategoryId !== '0' && subCategoryId !== 'undefined' ? parseInt(subCategoryId) : null;
            let subCategoryName = null;
            if (subCatIdInt) {
                const subCatResult = await request.query(`SELECT Name FROM SubCategories WHERE SubCategoryID = ${subCatIdInt}`);
                subCategoryName = subCatResult.recordset[0] ? subCatResult.recordset[0].Name : null;
            }

            await request
                .input('Name', sql.NVarChar(150), name)
                .input('Description', sql.NVarChar(sql.MAX), description)
                .input('Price', sql.Decimal(10, 2), parseFloat(price))
                .input('Unit', sql.NVarChar(50), unit)
                .input('CategoryID', sql.Int, catIdInt)
                .input('CategoryName', sql.NVarChar(100), categoryName)
                .input('IsVeg', sql.Bit, isVegBit)
                .input('ImageURL', sql.NVarChar(255), imageUrl)
                .input('Stock', sql.Int, parseInt(stock)) 
                .input('SubCategoryID', sql.Int, subCatIdInt)
                .input('SubCategoryName', sql.NVarChar(100), subCategoryName)
                .input('Barcode', sql.NVarChar(100), barcode || null)
                .query(`
                    INSERT INTO dbo.Products 
                    (Name, Description, Price, Unit, CategoryID, Category, SubCategoryID, SubCategory, IsVeg, ImageURL, IsActive, CreatedAt, StockQuantity, Barcode)
                    VALUES 
                    (@Name, @Description, @Price, @Unit, @CategoryID, @CategoryName, @SubCategoryID, @SubCategoryName, @IsVeg, @ImageURL, 1, GETDATE(), @Stock, @Barcode);
                `);

            
            // Increment ItemCount
            await new sql.Request().query(`UPDATE Categories SET ItemCount = ItemCount + 1 WHERE CategoryID = ${catIdInt}`);

            res.status(201).json({ message: "Product added successfully" });

        } catch (error) {
            console.error("Add Error:", error);
            res.status(500).json({ error: 'Failed to add product.' });
        }
    },
    
    // --- 2. Update Existing Product ---
    updateProduct: async (req, res) => {
        try {
            const productId = req.params.id;
            const { name, description, price, unit, categoryId, subCategoryId, isVeg, stock, barcode, existingImageURL, imageUrlLink } = req.body;

            
            let imageUrl = existingImageURL;
            if (req.file) imageUrl = `uploads/${req.file.filename}`;
            else if (imageUrlLink && imageUrlLink.trim() !== "") imageUrl = imageUrlLink;
            
            if (!name || !price || !unit || !categoryId || !barcode) {
                return res.status(400).json({ message: "Missing required fields, including Barcode." });
            }

            
            const isVegBit = (isVeg === 'true' || isVeg === true) ? 1 : 0;
            const newCatId = parseInt(categoryId);

            // Get Old Category ID to handle ItemCount updates
            const checkRequest = new sql.Request();
            const oldProdResult = await checkRequest.query(`SELECT CategoryID FROM Products WHERE ProductID = ${productId}`);
            const oldCatId = oldProdResult.recordset[0] ? oldProdResult.recordset[0].CategoryID : null;

            // Fetch New Category Name
            const catNameRequest = new sql.Request();
            const catResult = await catNameRequest.query(`SELECT Name FROM Categories WHERE CategoryID = ${newCatId}`);
            const newCategoryName = catResult.recordset[0] ? catResult.recordset[0].Name : 'Unknown';

            // Fetch SubCategory Name if provided
            const newSubCatId = subCategoryId && subCategoryId !== '0' && subCategoryId !== 'undefined' ? parseInt(subCategoryId) : null;
            let subCategoryName = null;
            if (newSubCatId) {
                const subCatResult = await catNameRequest.query(`SELECT Name FROM SubCategories WHERE SubCategoryID = ${newSubCatId}`);
                subCategoryName = subCatResult.recordset[0] ? subCatResult.recordset[0].Name : null;
            }

            const request = new sql.Request();
            await request
                .input('ProductID', sql.Int, parseInt(productId))
                .input('Name', sql.NVarChar(150), name)
                .input('Description', sql.NVarChar(sql.MAX), description)
                .input('Price', sql.Decimal(10, 2), parseFloat(price))
                .input('Unit', sql.NVarChar(50), unit)
                .input('CategoryID', sql.Int, newCatId)
                .input('CategoryName', sql.NVarChar(100), newCategoryName)
                .input('IsVeg', sql.Bit, isVegBit)
                .input('ImageURL', sql.NVarChar(255), imageUrl) 
                .input('Stock', sql.Int, parseInt(stock)) 
                .input('SubCategoryID', sql.Int, newSubCatId)
                .input('SubCategoryName', sql.NVarChar(100), subCategoryName)
                .input('Barcode', sql.NVarChar(100), barcode || null)
                .query(`
                    UPDATE dbo.Products
                    SET 
                        Name = @Name,
                        Description = @Description,
                        Price = @Price,
                        Unit = @Unit,
                        CategoryID = @CategoryID,
                        Category = @CategoryName, 
                        SubCategoryID = @SubCategoryID,
                        SubCategory = @SubCategoryName,
                        IsVeg = @IsVeg,
                        ImageURL = @ImageURL,
                        StockQuantity = @Stock,
                        Barcode = @Barcode
                    WHERE ProductID = @ProductID;
                `);


            if (oldCatId && oldCatId !== newCatId) {
                const countReq = new sql.Request();
                await countReq.query(`UPDATE Categories SET ItemCount = ItemCount - 1 WHERE CategoryID = ${oldCatId}`);
                await countReq.query(`UPDATE Categories SET ItemCount = ItemCount + 1 WHERE CategoryID = ${newCatId}`);
            }

            res.status(200).json({ message: "Product updated successfully" });

        } catch (error) {
            console.error("Update Error:", error);
            res.status(500).json({ error: 'Failed to update product.' });
        }
    },

    // --- 3. Delete Product (Soft Delete) ---
    deleteProduct: async (req, res) => {
        try {
            const productId = req.params.id;
            const checkRequest = new sql.Request();
            const prodResult = await checkRequest.query(`SELECT CategoryID FROM Products WHERE ProductID = ${productId} AND IsActive = 1`);
            
            if (prodResult.recordset.length > 0) {
                const catId = prodResult.recordset[0].CategoryID;
                const request = new sql.Request();
                await request.input('ProductID', sql.Int, parseInt(productId))
                             .query(`UPDATE dbo.Products SET IsActive = 0 WHERE ProductID = @ProductID`);

                if (catId) {
                    await new sql.Request().query(`UPDATE Categories SET ItemCount = ItemCount - 1 WHERE CategoryID = ${catId}`);
                }
            }

            res.status(200).json({ message: "Product deleted successfully" });
        } catch (error) {
            console.error("Delete Error:", error);
            res.status(500).json({ error: 'Failed to delete product.' });
        }
    },

    // --- 4. FIXED: Get All Products with Filters (Category, Limit) ---
    getAllProducts: async (req, res) => {
        try {
            // Extract query params sent by StocksPanel.tsx
            const { category, limit } = req.query;
            const request = new sql.Request();

            // Build dynamic query base
            let query = `
                SELECT 
                    ${limit && limit !== 'all' ? `TOP ${parseInt(limit)}` : ''} 
                    p.ProductID, p.Name, p.Description, p.Unit, p.CategoryID, p.Category, p.SubCategoryID, p.SubCategory, 
                    p.IsVeg, p.ImageURL, p.IsActive, p.CreatedAt, p.StockQuantity, p.Barcode,

                    p.Price AS OriginalPrice, 
                    COALESCE(pd.DealPrice, p.Price) AS Price, 
                    pd.DealPrice, 
                    pd.DiscountPercentage, 
                    pd.EndTime AS DealEndTime
                FROM Products p
                LEFT JOIN ProductDeals pd ON p.ProductID = pd.ProductID 
                    AND pd.IsActive = 1 
                    AND pd.EndTime > GETUTCDATE()
                WHERE p.IsActive = 1
            `;

            // Apply category filter if it's not "All"
            if (category && category !== 'All') {
                request.input('categoryParam', sql.NVarChar, category);
                query += ` AND p.Category = @categoryParam`;
            }

            query += ` ORDER BY p.CreatedAt DESC`;

            const result = await request.query(query);
            res.json(result.recordset);
        } catch (err) {
            console.error("Fetch Error:", err);
            res.status(500).json({ error: 'Failed to fetch products' });
        }
    },

    // --- 5. Get Single Product ---
    getProductById: async (req, res) => {
        try {
            const { id } = req.params;
            const request = new sql.Request();
            const result = await request
                .input('ProductID', sql.Int, id)
                .query(`
                    SELECT 
                        p.ProductID, p.Name, p.Description, p.Unit, p.CategoryID, p.Category, p.SubCategoryID, p.SubCategory, 
                        p.IsVeg, p.ImageURL, p.IsActive, p.CreatedAt, p.StockQuantity, p.Barcode,

                        p.Price AS OriginalPrice,
                        COALESCE(pd.DealPrice, p.Price) AS Price,
                        pd.DealPrice, 
                        pd.DiscountPercentage, 
                        pd.EndTime AS DealEndTime
                    FROM Products p
                    LEFT JOIN ProductDeals pd ON p.ProductID = pd.ProductID 
                        AND pd.IsActive = 1 
                        AND pd.EndTime > GETUTCDATE()
                    WHERE p.ProductID = @ProductID
                `);

            if (result.recordset.length === 0) {
                return res.status(404).json({ message: "Product not found" });
            }

            res.json(result.recordset[0]);
        } catch (err) {
            console.error("Fetch One Error:", err);
            res.status(500).json({ error: 'Failed to fetch product' });
        }
    },
    // --- 6. Get Single Product by Barcode ---
    getProductByBarcode: async (req, res) => {
        try {
            const { barcode } = req.params;
            const request = new sql.Request();
            const result = await request
                .input('Barcode', sql.NVarChar(100), barcode)
                .query(`
                    SELECT 
                        p.ProductID, p.Name, p.Description, p.Unit, p.CategoryID, p.Category, p.SubCategoryID, p.SubCategory, 
                        p.IsVeg, p.ImageURL, p.IsActive, p.CreatedAt, p.StockQuantity, p.Barcode,
                        p.Price AS OriginalPrice,
                        COALESCE(pd.DealPrice, p.Price) AS Price,
                        pd.DealPrice, 
                        pd.DiscountPercentage, 
                        pd.EndTime AS DealEndTime
                    FROM Products p
                    LEFT JOIN ProductDeals pd ON p.ProductID = pd.ProductID 
                        AND pd.IsActive = 1 
                        AND pd.EndTime > GETUTCDATE()
                    WHERE p.Barcode = @Barcode AND p.IsActive = 1
                `);

            if (result.recordset.length === 0) {
                return res.status(404).json({ message: "Product not found" });
            }

            res.json(result.recordset[0]);
        } catch (err) {
            console.error("Fetch by Barcode Error:", err);
            res.status(500).json({ error: 'Failed to fetch product' });
        }
    },
};


module.exports = productController;