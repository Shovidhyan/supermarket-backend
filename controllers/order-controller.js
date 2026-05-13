const { sql } = require('../db');
const Razorpay = require('razorpay');
const crypto = require('crypto');

// Check for Keys
if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    console.error("ERROR: Razorpay Keys are missing in .env file!");
}

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

// --- REWARD SYSTEM HELPERS ---
const REWARD_CONFIG = {
    EARN_RATE: 10,       // 10 points
    EARN_THRESHOLD: 100, // per 100 Rupees
    REDEMPTION_VAL: 5    // 5 points = 1 Rupee
};

const _updateRewardPoints = async (transaction, userId, orderId, totalAmount, pointsRedeemed) => {
    const request = new sql.Request(transaction);

    // 1. Handle Redemption (Deduct points from the separate RewardBalances table)
    if (pointsRedeemed > 0) {
        await request.query(`
            UPDATE RewardBalances 
            SET TotalPoints = TotalPoints - ${pointsRedeemed}, LastUpdated = GETDATE() 
            WHERE UserID = ${userId};

            INSERT INTO RewardTransactions (UserID, OrderID, PointsChange, Reason) 
            VALUES (${userId}, ${orderId}, -${pointsRedeemed}, 'Redeemed on Order');
        `);
    }

    // 2. Handle Earning (Earn 10 coins per 100 spent)
    const pointsEarned = Math.floor(totalAmount / REWARD_CONFIG.EARN_THRESHOLD) * REWARD_CONFIG.EARN_RATE;
    
    if (pointsEarned > 0) {
        await request.query(`
            IF EXISTS (SELECT 1 FROM RewardBalances WHERE UserID = ${userId})
                UPDATE RewardBalances SET TotalPoints = TotalPoints + ${pointsEarned}, LastUpdated = GETDATE() WHERE UserID = ${userId};
            ELSE
                INSERT INTO RewardBalances (UserID, TotalPoints) VALUES (${userId}, ${pointsEarned});

            INSERT INTO RewardTransactions (UserID, OrderID, PointsChange, Reason) 
            VALUES (${userId}, ${orderId}, ${pointsEarned}, 'Earned from Order');
        `);
    }
};

/**
 * Fetches cart items and checks for active Deal Prices.
 * This ensures "Grab Deal" discounts are locked into the order history.
 */
const _getCartItemsForOrderPlacement = async (userId) => {
    const cartResult = await sql.query`
        SELECT 
            ci.ProductID, 
            ci.Quantity, 
            p.Price AS OriginalPrice,
            pd.DealPrice
        FROM CartItems ci
        JOIN Cart c ON ci.CartID = c.CartID
        JOIN Products p ON ci.ProductID = p.ProductID
        LEFT JOIN ProductDeals pd ON p.ProductID = pd.ProductID 
            AND pd.IsActive = 1 
            AND pd.EndTime > GETUTCDATE()
        WHERE c.UserID = ${userId}
    `;
    
    return cartResult.recordset.map(item => ({
        ProductID: item.ProductID,
        Quantity: item.Quantity,
        Price: item.DealPrice !== null ? item.DealPrice : item.OriginalPrice 
    }));
};

const orderController = {

    getRewardsSummary: async (req, res) => {
        const userId = req.user.id;
        try {
            const balanceRes = await sql.query`SELECT TotalPoints FROM RewardBalances WHERE UserID = ${userId}`;
            const historyRes = await sql.query`
                SELECT TOP 15 * FROM RewardTransactions 
                WHERE UserID = ${userId} ORDER BY CreatedAt DESC
            `;
            res.json({
                balance: balanceRes.recordset[0]?.TotalPoints || 0,
                transactions: historyRes.recordset
            });
        } catch (err) {
            console.error("Rewards Summary Error:", err);
            res.status(500).json({ error: 'Failed to fetch rewards' });
        }
    },

    getDashboardStats: async (req, res) => {
        try {
            // Updated: Both Revenue and Order count now exclude 'Cancelled' orders
            const revenueRes = await sql.query`
                SELECT ISNULL(SUM(TotalAmount), 0) as TotalRevenue 
                FROM Orders 
                WHERE Status != 'Cancelled'
            `;
            const ordersRes = await sql.query`
                SELECT COUNT(*) as TotalOrders 
                FROM Orders 
                WHERE Status != 'Cancelled'
            `;
            const usersRes = await sql.query`SELECT COUNT(*) as TotalUsers FROM Users`;

            const totalRevenue = revenueRes.recordset[0].TotalRevenue;
            const totalOrders = ordersRes.recordset[0].TotalOrders;
            const totalUsers = usersRes.recordset[0].TotalUsers;

            res.json({ totalRevenue, totalOrders, totalUsers });
        } catch (err) {
            console.error("Dashboard Stats Error:", err);
            res.json({ totalRevenue: 0, totalOrders: 0, totalUsers: 0 });
        }
    },

    createRazorpayOrder: async (req, res) => {
        const { totalAmount } = req.body; 
        try {
            const options = {
                amount: Math.round(totalAmount * 100), 
                currency: "INR",
                receipt: `receipt_${new Date().getTime()}`,
            };
            const order = await razorpay.orders.create(options);
            res.json(order); 
        } catch (error) {
            res.status(500).json({ error: "Failed to create payment order" });
        }
    },

    verifyAndPlaceOrder: async (req, res) => {
        const userId = req.user.id;
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature, addressId, totalAmount, pointsToRedeem } = req.body;

        let transaction;
        try {
            const body = razorpay_order_id + "|" + razorpay_payment_id;
            const expectedSignature = crypto
                .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
                .update(body.toString())
                .digest('hex');

            if (expectedSignature !== razorpay_signature) {
                return res.status(400).json({ message: "Invalid Payment Signature" });
            }

            transaction = new sql.Transaction(req.db);
            await transaction.begin();
            
            const itemsForOrder = await _getCartItemsForOrderPlacement(userId);
            
            if (itemsForOrder.length === 0) {
                 await transaction.rollback();
                 return res.status(400).json({ message: "Cart is empty." });
            }

            const request = new sql.Request(transaction);
            const orderInsertResult = await request
                .input('UserID', sql.Int, userId)
                .input('TotalAmount', sql.Decimal(10, 2), totalAmount)
                .input('Status', sql.NVarChar(50), 'Pending')
                .input('DeliveryAddressID', sql.Int, addressId) 
                .input('PaymentType', sql.NVarChar(50), 'Razorpay')
                .input('DeliveryStatus', sql.NVarChar(50), 'Pending')
                .query(`
                    INSERT INTO dbo.Orders 
                    (UserID, TotalAmount, Status, DeliveryAddressID, PaymentType, OrderDate, DeliveryStatus) 
                    VALUES 
                    (@UserID, @TotalAmount, @Status, @DeliveryAddressID, @PaymentType, GETDATE(), @DeliveryStatus); 
                    SELECT SCOPE_IDENTITY() AS OrderID;
                `);
            
            const newOrderId = orderInsertResult.recordset[0].OrderID;

            for (const item of itemsForOrder) {
                const itemReq = new sql.Request(transaction);
                await itemReq.query(`
                    INSERT INTO dbo.OrderItems (OrderID, ProductID, Quantity, Price) 
                    VALUES (${newOrderId}, ${item.ProductID}, ${item.Quantity}, ${item.Price})
                `);
                
                const stockReq = new sql.Request(transaction);
                await stockReq.query(`
                    UPDATE Products 
                    SET StockQuantity = StockQuantity - ${item.Quantity} 
                    WHERE ProductID = ${item.ProductID}
                `);
            }

            const paymentReq = new sql.Request(transaction);
            await paymentReq.query(`
                INSERT INTO dbo.Payments 
                (OrderID, PaymentMethod, PaymentStatus, TransactionID, PaidAmount, PaidAt) 
                VALUES 
                (${newOrderId}, 'Razorpay', 'Success', '${razorpay_payment_id}', ${totalAmount}, GETDATE())
            `);

            await _updateRewardPoints(transaction, userId, newOrderId, totalAmount, pointsToRedeem || 0);

            const clearReq = new sql.Request(transaction);
            await clearReq.query(`
                DELETE FROM CartItems 
                WHERE CartID IN (SELECT CartID FROM Cart WHERE UserID = ${userId})
            `);

            await transaction.commit();
            res.status(201).json({ message: "Order placed successfully", OrderID: newOrderId });

        } catch (error) {
            if (transaction) await transaction.rollback();
            console.error("Payment Order placement error:", error);
            res.status(500).json({ error: 'Failed to place order.' });
        }
    },

    placeOrderCOD: async (req, res) => {
        const userId = req.user.id;
        const { addressId, totalAmount, pointsToRedeem } = req.body;
        
        let transaction;
        try {
            transaction = new sql.Transaction(req.db);
            await transaction.begin();
            
            const itemsForOrder = await _getCartItemsForOrderPlacement(userId);
            if (itemsForOrder.length === 0) throw new Error("Cart empty");

            const request = new sql.Request(transaction);
            const orderRes = await request
                .input('UserID', sql.Int, userId)
                .input('TotalAmt', sql.Decimal(10, 2), totalAmount)
                .input('AddrID', sql.Int, addressId)
                .input('DeliveryStatus', sql.NVarChar(50), 'Pending')
                .query(`
                    INSERT INTO dbo.Orders 
                    (UserID, TotalAmount, Status, DeliveryAddressID, PaymentType, OrderDate, DeliveryStatus) 
                    VALUES 
                    (@UserID, @TotalAmt, 'Pending', @AddrID, 'COD', GETDATE(), @DeliveryStatus); 
                    SELECT SCOPE_IDENTITY() AS OrderID;
                `);
            
            const newOrderId = orderRes.recordset[0].OrderID;

            for (const item of itemsForOrder) {
                const itemReq = new sql.Request(transaction);
                await itemReq.query(`
                    INSERT INTO dbo.OrderItems (OrderID, ProductID, Quantity, Price) 
                    VALUES (${newOrderId}, ${item.ProductID}, ${item.Quantity}, ${item.Price})
                `);
                
                const stockReq = new sql.Request(transaction);
                await stockReq.query(`
                    UPDATE Products 
                    SET StockQuantity = StockQuantity - ${item.Quantity} 
                    WHERE ProductID = ${item.ProductID}
                `);
            }

            const paymentReq = new sql.Request(transaction);
            await paymentReq.query(`
                INSERT INTO dbo.Payments (OrderID, PaymentMethod, PaymentStatus, PaidAmount) 
                VALUES (${newOrderId}, 'COD', 'Pending', 0)
            `);

            await _updateRewardPoints(transaction, userId, newOrderId, totalAmount, pointsToRedeem || 0);

            const delReq = new sql.Request(transaction);
            await delReq.query(`
                DELETE FROM CartItems 
                WHERE CartID IN (SELECT CartID FROM Cart WHERE UserID = ${userId})
            `);

            await transaction.commit();
            res.status(201).json({ message: "COD Order Placed", OrderID: newOrderId });

        } catch(err) {
            if(transaction) await transaction.rollback();
            console.error("COD placement error:", err);
            res.status(500).json({error: "COD Failed"});
        }
    },

    getOrderById: async (req, res) => {
        const userId = req.user.id;
        const orderId = req.params.id;
        try {
            const orderRes = await sql.query`SELECT * FROM Orders WHERE OrderID = ${orderId} AND UserID = ${userId}`;
            if (orderRes.recordset.length === 0) return res.status(404).json({message: "Not Found"});
            const order = orderRes.recordset[0];

            const itemsRes = await sql.query`
                SELECT oi.*, p.Name, p.ImageURL 
                FROM OrderItems oi 
                LEFT JOIN Products p ON oi.ProductID = p.ProductID 
                WHERE oi.OrderID = ${orderId}
            `;
            const addrRes = await sql.query`SELECT * FROM Addresses WHERE AddressID = ${order.DeliveryAddressID}`;
            const payRes = await sql.query`SELECT PaymentStatus, TransactionID FROM Payments WHERE OrderID = ${orderId}`;

            res.json({ 
                ...order, 
                items: itemsRes.recordset, 
                deliveryAddress: addrRes.recordset[0] || null, 
                paymentInfo: payRes.recordset[0] || null 
            });
        } catch(e) { 
            res.status(500).send("Error fetching order"); 
        }
    },

    getMyOrders: async (req, res) => {
        const userId = req.user.id;
        try {
            const result = await sql.query`
                SELECT 
                    o.OrderID, o.OrderDate, o.TotalAmount, o.Status, o.PaymentType, o.DeliveryStatus,
                    (SELECT COUNT(*) FROM OrderItems WHERE OrderID = o.OrderID) as ItemCount,
                    p.PaymentStatus
                FROM Orders o
                LEFT JOIN Payments p ON o.OrderID = p.OrderID
                WHERE o.UserID = ${userId}
                ORDER BY o.OrderDate DESC
            `;
            res.json(result.recordset);
        } catch (err) {
            res.status(500).json({ error: 'Failed to fetch orders' });
        }
    },

    cancelOrder: async (req, res) => {
        const userId = req.user.id; 
        const orderId = req.params.id;
        try {
            const checkRes = await sql.query`
                SELECT Status, DeliveryPartnerID FROM Orders 
                WHERE OrderID = ${orderId} AND UserID = ${userId}
            `;
            if (checkRes.recordset.length === 0) return res.status(404).json({ message: "Order not found" });

            const currentStatus = checkRes.recordset[0].Status;
            const cancellableStatuses = ['Pending', 'Processing']; 
            
            if (!cancellableStatuses.some(s => s.toLowerCase() === currentStatus.toLowerCase())) {
                return res.status(400).json({ message: `Order cannot be cancelled at the current stage (${currentStatus}).` });
            }

            await sql.query`
                UPDATE Orders SET Status = 'Cancelled', DeliveryStatus = 'Cancelled', DeliveryPartnerID = NULL 
                WHERE OrderID = ${orderId}
            `;
            res.json({ message: "Order cancelled successfully" });
        } catch (err) {
            res.status(500).json({ error: 'Failed to cancel order' });
        }
    },

    getAllOrdersAdmin: async (req, res) => {
        try {
            const result = await sql.query`
                SELECT o.OrderID, o.OrderDate, o.TotalAmount, o.Status, o.PaymentType, u.FullName as CustomerName,
                    (SELECT COUNT(*) FROM OrderItems WHERE OrderID = o.OrderID) as ItemCount
                FROM Orders o LEFT JOIN Users u ON o.UserID = u.UserID ORDER BY o.OrderDate DESC
            `;
            res.json(result.recordset);
        } catch (err) {
            res.status(500).json({ error: 'Failed to fetch admin orders' });
        }
    },

    updateOrderStatus: async (req, res) => {
        const { id } = req.params;
        const { status } = req.body; 
        try {
            await sql.query`UPDATE Orders SET Status = ${status}, DeliveryStatus = ${status} WHERE OrderID = ${id}`;
            res.json({ message: `Order #${id} status updated to ${status}` });
        } catch (err) {
            res.status(500).json({ error: 'Failed to update status' });
        }
    },

    getAdminOrderDetails: async (req, res) => {
        const { id } = req.params;
        try {
            const orderRes = await sql.query`
                SELECT o.*, u.FullName as CustomerName, u.Email 
                FROM Orders o LEFT JOIN Users u ON o.UserID = u.UserID WHERE o.OrderID = ${id}
            `;
            if (orderRes.recordset.length === 0) return res.status(404).json({ message: "Order not found" });
            const order = orderRes.recordset[0];
            const itemsRes = await sql.query`
                SELECT oi.*, p.Name, p.ImageURL, p.Unit FROM OrderItems oi 
                LEFT JOIN Products p ON oi.ProductID = p.ProductID WHERE oi.OrderID = ${id}
            `;
            const addrRes = await sql.query`SELECT * FROM Addresses WHERE AddressID = ${order.DeliveryAddressID}`;

            res.json({ ...order, items: itemsRes.recordset, deliveryAddress: addrRes.recordset[0] || null });
        } catch (err) {
            res.status(500).json({ error: 'Failed to fetch order details' });
        }
    },

    getOMSOrders: async (req, res) => {
        try {
            const result = await sql.query`
                SELECT o.OrderID, o.OrderDate, o.TotalAmount, o.Status, o.PaymentType, u.FullName as CustomerName,
                    (SELECT COUNT(*) FROM OrderItems WHERE OrderID = o.OrderID) as ItemCount,
                    ISNULL(c.IsRead, 0) AS IsRead,
                    c.ChecklistData
                FROM Orders o 
                LEFT JOIN Users u ON o.UserID = u.UserID 
                LEFT JOIN OrderChecklists c ON o.OrderID = c.OrderID
                WHERE o.Status IN ('Pending', 'Processing')
                ORDER BY o.OrderDate DESC
            `;
            res.json(result.recordset);
        } catch (err) {
            console.error("Failed to fetch OMS orders:", err);
            res.status(500).json({ error: 'Failed to fetch OMS orders' });
        }
    },

    markAllAsRead: async (req, res) => {
        try {
            await sql.query`
                MERGE INTO OrderChecklists AS target
                USING (SELECT OrderID FROM Orders WHERE Status IN ('Pending', 'Processing')) AS source
                ON target.OrderID = source.OrderID
                WHEN MATCHED THEN
                    UPDATE SET target.IsRead = 1
                WHEN NOT MATCHED THEN
                    INSERT (OrderID, IsRead) VALUES (source.OrderID, 1);
            `;
            res.json({ message: 'All pending orders marked as read' });
        } catch (err) {
            console.error("Failed to mark all as read:", err);
            res.status(500).json({ error: 'Failed to update' });
        }
    },

    markOrderAsRead: async (req, res) => {
        const { id } = req.params;
        const { checklistData } = req.body;
        
        try {
            // Upsert into OrderChecklists (Merge syntax for SQL Server)
            await sql.query`
                MERGE INTO OrderChecklists AS target
                USING (SELECT ${id} AS OrderID) AS source
                ON target.OrderID = source.OrderID
                WHEN MATCHED THEN
                    UPDATE SET target.IsRead = 1, target.ChecklistData = ISNULL(${checklistData}, target.ChecklistData)
                WHEN NOT MATCHED THEN
                    INSERT (OrderID, IsRead, ChecklistData) VALUES (${id}, 1, ${checklistData});
            `;
            res.json({ message: 'Order marked as read' });
        } catch (err) {
            console.error("Failed to mark order as read:", err);
            res.status(500).json({ error: 'Failed to update order status' });
        }
    },

    // --- PICKER ENDPOINTS ---
    pickerGetOrderById: async (req, res) => {
        const orderId = req.params.id;
        try {
            const orderRes = await sql.query`
                SELECT o.*, u.FullName as CustomerName 
                FROM Orders o 
                LEFT JOIN Users u ON o.UserID = u.UserID 
                WHERE o.OrderID = ${orderId} AND o.Status IN ('Pending', 'Processing')
            `;
            if (orderRes.recordset.length === 0) {
                return res.status(404).json({ message: "Order not found or not available for picking (already processed/cancelled)." });
            }
            const order = orderRes.recordset[0];

            const itemsRes = await sql.query`
                SELECT oi.*, p.Name, p.ImageURL, p.Unit 
                FROM OrderItems oi 
                LEFT JOIN Products p ON oi.ProductID = p.ProductID 
                WHERE oi.OrderID = ${orderId}
            `;

            // Also fetch the checklist if it exists
            const checklistRes = await sql.query`
                SELECT IsRead, ChecklistData FROM OrderChecklists WHERE OrderID = ${orderId}
            `;

            res.json({ 
                ...order, 
                items: itemsRes.recordset, 
                checklist: checklistRes.recordset[0] || null
            });
        } catch (err) { 
            console.error("Picker get order error:", err);
            res.status(500).json({ error: "Error fetching order for picker" }); 
        }
    },

    pickerProcessOrder: async (req, res) => {
        const { id } = req.params;
        let transaction;
        try {
            transaction = new sql.Transaction(req.db);
            await transaction.begin();
            const request = new sql.Request(transaction);

            // 1. Update Order Status to Processing
            await request.query(`
                UPDATE Orders SET Status = 'Processing', DeliveryStatus = 'Processing' WHERE OrderID = ${id}
            `);

            // 2. Upsert OrderChecklists to IsRead = 1, so it clears from Admin OMS panel
            const checklistDataStr = JSON.stringify({ packed: true, invoiced: true });
            await request.query(`
                MERGE INTO OrderChecklists AS target
                USING (SELECT ${id} AS OrderID) AS source
                ON target.OrderID = source.OrderID
                WHEN MATCHED THEN
                    UPDATE SET target.IsRead = 1, target.ChecklistData = '${checklistDataStr}'
                WHEN NOT MATCHED THEN
                    INSERT (OrderID, IsRead, ChecklistData) VALUES (${id}, 1, '${checklistDataStr}');
            `);

            await transaction.commit();
            res.json({ message: 'Order processed successfully' });
        } catch (err) {
            if (transaction) await transaction.rollback();
            console.error("Picker process order error:", err);
            res.status(500).json({ error: 'Failed to process order' });
        }
    }
};

module.exports = orderController;