const express = require('express');
const router = express.Router();
const { sql } = require('../db');
const bcrypt = require('bcryptjs'); 
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// --- AUTHENTICATION MIDDLEWARES ---

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ message: 'Authentication required' });

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret_key');
        req.user = decoded; 
        next();
    } catch (err) {
        return res.status(401).json({ message: 'Invalid token' });
    }
};

const authenticatePartner = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ message: 'Authentication required' });

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret_key');
        if (decoded.role !== 'delivery_partner') {
            return res.status(403).json({ message: 'Access denied: Not a delivery partner' });
        }
        req.user = decoded; 
        next();
    } catch (err) {
        return res.status(401).json({ message: 'Invalid token' });
    }
};

// 1. REGISTER NEW PARTNER
router.post('/register', async (req, res) => {
    try {
        const { fullName, email, phone, password, perOrderFee } = req.body;
        
        const checkRequest = new sql.Request();
        const checkResult = await checkRequest
            .input('Email', sql.NVarChar, email)
            .query('SELECT PartnerID FROM DeliveryPartners WHERE Email = @Email');
        
        if (checkResult.recordset.length > 0) {
            return res.status(409).json({ message: 'A partner with this email already exists.' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const request = new sql.Request();
        
        await request
            .input('Name', sql.NVarChar, fullName)
            .input('Email', sql.NVarChar, email)
            .input('Phone', sql.NVarChar, phone)
            .input('Pass', sql.NVarChar, hashedPassword)
            .input('Fee', sql.Decimal, perOrderFee)
            .query(`
                INSERT INTO DeliveryPartners (FullName, Email, PhoneNumber, PasswordHash, PerOrderFee, CurrentStatus)
                VALUES (@Name, @Email, @Phone, @Pass, @Fee, 'Offline')
            `);

        res.status(201).json({ message: 'Partner registered successfully' });
    } catch (err) {
        console.error("Registration Error:", err);
        res.status(500).json({ message: 'Error registering partner', error: err.message });
    }
});

// 2. PARTNER LOGIN
router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const request = new sql.Request();
        
        const result = await request
            .input('LoginEmail', sql.NVarChar, email)
            .query('SELECT * FROM DeliveryPartners WHERE Email = @LoginEmail');

        const partner = result.recordset[0];

        if (!partner) {
            return res.status(400).json({ message: "Delivery partner not found" });
        }

        const isMatch = await bcrypt.compare(password, partner.PasswordHash);
        if (!isMatch) {
            return res.status(400).json({ message: "Invalid credentials" });
        }

        if (partner.IsActive === false) { 
            return res.status(403).json({ message: "Account is inactive." });
        }

        const token = jwt.sign(
            { id: partner.PartnerID, role: 'delivery_partner', email: partner.Email }, 
            process.env.JWT_SECRET || 'secret_key', 
            { expiresIn: '1d' }
        );

        res.json({ 
            token, 
            user: { 
                PartnerID: partner.PartnerID, 
                name: partner.FullName, 
                email: partner.Email, 
                role: 'delivery_partner',
                CurrentStatus: partner.CurrentStatus 
            } 
        });

    } catch (err) {
        console.error("Partner Login Error:", err);
        res.status(500).json({ message: 'Server error during login' });
    }
});

// --- UPDATED PAYROLL: MANUAL SETTLEMENT (REPLACES RAZORPAY) ---

router.post('/manual-payout', authenticateToken, async (req, res) => {
    const { partnerId, amount } = req.body;
    
    if (!partnerId || !amount) {
        return res.status(400).json({ message: "Partner ID and Amount are required." });
    }

    let transaction;
    try {
        transaction = new sql.Transaction();
        await transaction.begin();

        // 1. Mark orders as 'PaidOut'
        const orderUpdateRequest = new sql.Request(transaction);
        await orderUpdateRequest
            .input('PartnerId', sql.Int, partnerId)
            .query(`
                UPDATE Orders 
                SET PayoutStatus = 'PaidOut' 
                WHERE DeliveryPartnerID = @PartnerId 
                AND DeliveryStatus = 'Delivered' 
                AND (PayoutStatus IS NULL OR PayoutStatus <> 'PaidOut')
            `);

        // 2. Record the payout in history table [PartnerPayouts]
        const payoutRecordRequest = new sql.Request(transaction);
        const refId = `MANUAL-${Date.now()}`;
        await payoutRecordRequest
            .input('PartnerId', sql.Int, partnerId)
            .input('Amount', sql.Decimal(18, 2), amount)
            .input('RefId', sql.NVarChar, refId)
            .query(`
                INSERT INTO PartnerPayouts (PartnerID, Amount, PayoutDate, ReferenceID)
                VALUES (@PartnerId, @Amount, GETDATE(), @RefId)
            `);

        await transaction.commit();
        res.json({ message: "Payout marked successfully. Balance updated." });
    } catch (err) {
        if (transaction) await transaction.rollback();
        console.error("Manual Payout Error:", err);
        res.status(500).json({ message: "Failed to process manual payout", error: err.message });
    }
});

// 3. GET ADMIN DASHBOARD STATS (UPDATED FOR MANUAL PAYOUTS & ORDERS POST-PAYOUT)
router.get('/dashboard-stats', authenticateToken, async (req, res) => {
    try {
        const request = new sql.Request();

        // Logic:
        // TotalDelivered = Lifetime orders
        // CurrentOrders = Orders delivered BUT NOT yet paid out
        // LastPayoutAmount/Date = Latest record from PartnerPayouts
        const result = await request.query(`
            SELECT 
                dp.PartnerID,
                dp.FullName,
                dp.Email, 
                dp.PhoneNumber,
                dp.CurrentStatus,
                dp.PerOrderFee,
                -- Lifetime total delivered
                (SELECT COUNT(*) FROM Orders o 
                 WHERE o.DeliveryPartnerID = dp.PartnerID 
                 AND o.DeliveryStatus = 'Delivered') as TotalDelivered,
                
                -- Orders delivered after last payout (unpaid)
                (SELECT COUNT(*) FROM Orders o 
                 WHERE o.DeliveryPartnerID = dp.PartnerID 
                 AND o.DeliveryStatus = 'Delivered'
                 AND (o.PayoutStatus IS NULL OR o.PayoutStatus <> 'PaidOut')) as CurrentOrders,

                -- Latest Payout Info for Action Column
                (SELECT TOP 1 Amount FROM PartnerPayouts pp 
                 WHERE pp.PartnerID = dp.PartnerID 
                 ORDER BY PayoutDate DESC) as LastPayoutAmount,

                (SELECT TOP 1 PayoutDate FROM PartnerPayouts pp 
                 WHERE pp.PartnerID = dp.PartnerID 
                 ORDER BY PayoutDate DESC) as LastPayoutDate,

                ISNULL((SELECT SUM(DATEDIFF(MINUTE, LoginTime, ISNULL(LogoutTime, GETDATE()))) / 60.0 
                 FROM DeliverySessions ds WHERE ds.PartnerID = dp.PartnerID), 0) as TotalHours,

                (SELECT COUNT(*) FROM DeliveryComplaints dc 
                 WHERE dc.PartnerID = dp.PartnerID) as ComplaintCount
            FROM DeliveryPartners dp
        `);

        const data = result.recordset.map(p => ({
            ...p,
            TotalHours: parseFloat(p.TotalHours.toFixed(2)),
            EstimatedSalary: p.CurrentOrders * p.PerOrderFee // Salary based on unpaid orders only
        }));

        res.json(data);
    } catch (err) {
        console.error("Stats Error:", err);
        res.status(500).json({ message: 'Error fetching stats', error: err.message });
    }
});

// 3B. GET PARTNER'S OWN STATS
router.get('/mydelivery-stats', authenticatePartner, async (req, res) => {
    try {
        const partnerId = req.user.id;
        const request = new sql.Request();

        const result = await request.input('PartnerId', sql.Int, partnerId).query(`
            SELECT 
                COUNT(*) as TotalDelivered,
                ISNULL(SUM(CASE WHEN PayoutStatus IS NULL OR PayoutStatus <> 'PaidOut' THEN 1 ELSE 0 END), 0) as UnpaidCount,
                (SELECT PerOrderFee FROM DeliveryPartners WHERE PartnerID = @PartnerId) as Fee
            FROM Orders 
            WHERE DeliveryPartnerID = @PartnerId AND DeliveryStatus = 'Delivered'
        `);

        const row = result.recordset[0];
        res.json({ 
            deliveredCount: row.TotalDelivered, 
            unpaidCount: row.UnpaidCount,
            remainingBalance: row.UnpaidCount * row.Fee
        });
    } catch (err) {
        console.error("My Stats Error:", err);
        res.status(500).json({ message: 'Error fetching my stats', error: err.message });
    }
});

// --- FIX 1: GET LIST OF DELIVERED ORDERS FOR PARTNER ---
router.get('/my-delivered-orders', authenticatePartner, async (req, res) => {
    try {
        const partnerId = req.user.id;
        const request = new sql.Request();

        const result = await request
            .input('PartnerId', sql.Int, partnerId)
            .query(`
                SELECT 
                    o.OrderID, 
                    o.TotalAmount, 
                    o.DeliveryStatus, 
                    o.OrderDate,
                    u.FullName as CustomerName
                FROM Orders o
                LEFT JOIN Users u ON o.UserID = u.UserID
                WHERE o.DeliveryPartnerID = @PartnerId 
                AND o.DeliveryStatus = 'Delivered'
                ORDER BY o.OrderDate DESC
            `);

        res.json(result.recordset);
    } catch (err) {
        console.error("Delivered Orders List Error:", err);
        res.status(500).json({ message: 'Error fetching delivered orders', error: err.message });
    }
});

// --- FIX 2: GET DETAILED INFO FOR A PREVIOUSLY DELIVERED ORDER ---
router.get('/delivered-order-details/:id', authenticatePartner, async (req, res) => {
    const { id } = req.params;
    const partnerId = req.user.id;

    try {
        const request = new sql.Request();
        const result = await request
            .input('OrderId', sql.Int, id)
            .input('PartnerId', sql.Int, partnerId)
            .query(`
                SELECT 
                    o.OrderID, o.TotalAmount, o.PaymentType, o.DeliveryStatus, 
                    ISNULL(u.FullName, 'Guest') as CustomerName, 
                    ISNULL(a.PrimaryPhone, 'N/A') as Phone,
                    ISNULL(a.FullAddress, 'No Address Provided') as FullAddress,
                    ISNULL(a.City, '') as City
                FROM Orders o
                LEFT JOIN Users u ON o.UserID = u.UserID
                LEFT JOIN Addresses a ON o.DeliveryAddressID = a.AddressID
                WHERE o.OrderID = @OrderId AND o.DeliveryPartnerID = @PartnerId
            `);

        if (result.recordset.length === 0) {
            return res.status(404).json({ message: "Order not found or not assigned to you." });
        }

        const order = result.recordset[0];

        const itemsResult = await new sql.Request()
            .input('OrderId', sql.Int, id)
            .query(`
                SELECT p.Name, oi.Quantity, p.Unit
                FROM OrderItems oi
                JOIN Products p ON oi.ProductID = p.ProductID
                WHERE oi.OrderID = @OrderId
            `);

        res.json({
            ...order,
            Items: itemsResult.recordset
        });
    } catch (err) {
        console.error("Delivered Order Details Error:", err);
        res.status(500).json({ message: 'Error fetching order details.' });
    }
});

// 4. UPDATE PARTNER DETAILS (Admin)
router.put('/update/:id', authenticateToken, async (req, res) => { 
    try {
        const { id } = req.params;
        const { fullName, phone, perOrderFee, status, password } = req.body;

        const request = new sql.Request();
        
        request.input('Id', sql.Int, id);
        request.input('Name', sql.NVarChar, fullName);
        request.input('Phone', sql.NVarChar, phone);
        request.input('Fee', sql.Decimal, perOrderFee);
        request.input('Status', sql.NVarChar, status || 'Offline');

        let passwordUpdateSQL = "";
        
        if (password && password.trim() !== "") {
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(password, salt);
            request.input('Pass', sql.NVarChar, hashedPassword);
            passwordUpdateSQL = ", PasswordHash = @Pass"; 
        }

        await request.query(`
            UPDATE DeliveryPartners 
            SET FullName = @Name, 
                PhoneNumber = @Phone, 
                PerOrderFee = @Fee,
                CurrentStatus = @Status
                ${passwordUpdateSQL}
            WHERE PartnerID = @Id
        `);

        res.json({ message: 'Partner updated successfully' });
    } catch (err) {
        console.error("Update Error:", err);
        res.status(500).json({ message: 'Error updating partner', error: err.message });
    }
});

// 5. GET ORDER DETAILS AND CLAIM FOR PARTNER
router.get('/order/:id', authenticatePartner, async (req, res) => {
    const { id } = req.params;
    const partnerId = req.user.id;
    let transaction;

    try {
        transaction = new sql.Transaction();
        await transaction.begin();
        const request = new sql.Request(transaction);

        const checkResult = await request
            .input('OrderId', sql.Int, id)
            .query(`
                SELECT DeliveryStatus, DeliveryPartnerID
                FROM Orders
                WHERE OrderID = @OrderId
            `);

        if (checkResult.recordset.length === 0) {
            await transaction.rollback();
            return res.status(404).json({ message: "Order not found." });
        }

        const orderInfo = checkResult.recordset[0];
        const currentStatus = orderInfo.DeliveryStatus;
        const currentPartnerId = orderInfo.DeliveryPartnerID;

        if (currentStatus === 'Delivered' || currentStatus === 'Cancelled') {
            if (currentPartnerId !== partnerId) {
                await transaction.rollback();
                return res.status(400).json({ message: `Order already ${currentStatus}.` });
            }
        } else if (currentPartnerId !== null && currentPartnerId !== partnerId) {
            await transaction.rollback();
            return res.status(403).json({ message: "Order already assigned." });
        }

        if (currentPartnerId === null && currentStatus !== 'Delivered' && currentStatus !== 'Cancelled') {
            await new sql.Request(transaction)
                .input('OrderId', sql.Int, id)
                .input('PartnerId', sql.Int, partnerId)
                .query(`
                    UPDATE Orders
                    SET DeliveryPartnerID = @PartnerId,
                        DeliveryStatus = 'Out for Delivery',
                        Status = 'Out for Delivery'
                    WHERE OrderID = @OrderId AND DeliveryPartnerID IS NULL
                `);
        } 

        const orderDetailsRequest = new sql.Request(transaction);
        orderDetailsRequest.input('OrderId', sql.Int, id);

        const orderResult = await orderDetailsRequest.query(`
                SELECT 
                    o.OrderID, o.TotalAmount, o.PaymentType, o.DeliveryStatus, 
                    ISNULL(u.FullName, 'Guest') as CustomerName, 
                    ISNULL(a.PrimaryPhone, 'N/A') as Phone,
                    ISNULL(a.FullAddress, 'No Address Provided') as FullAddress,
                    ISNULL(a.City, '') as City
                FROM Orders o
                LEFT JOIN Users u ON o.UserID = u.UserID
                LEFT JOIN Addresses a ON o.DeliveryAddressID = a.AddressID
                WHERE o.OrderID = @OrderId
            `);

        const order = orderResult.recordset[0];

        const itemsRequest = new sql.Request(transaction);
        itemsRequest.input('OrderId', sql.Int, id);

        const itemsResult = await itemsRequest.query(`
                SELECT p.Name, oi.Quantity, p.Unit
                FROM OrderItems oi
                JOIN Products p ON oi.ProductID = p.ProductID
                WHERE oi.OrderID = @OrderId
            `);

        await transaction.commit();

        res.json({
            ...order,
            Items: itemsResult.recordset
        });

    } catch (err) {
        if (transaction) await transaction.rollback();
        console.error("Scan/Claim Error:", err);
        res.status(500).json({ message: 'Error fetching/claiming order.' });
    }
});

// 6. UPDATE DELIVERY STATUS
router.put('/update-status', authenticatePartner, async (req, res) => {
    try {
        const { orderId, status } = req.body;
        const partnerId = req.user.id;
        const request = new sql.Request();

        const validPartnerUpdates = ['Assigned', 'Shipped', 'Out for Delivery', 'Delivered'];
        if (!validPartnerUpdates.includes(status)) {
            return res.status(400).json({ message: `Invalid status: ${status}` });
        }

        const updateResult = await request
            .input('OId', sql.Int, orderId)
            .input('Status', sql.NVarChar, status)
            .input('PId', sql.Int, partnerId)
            .query(`
                UPDATE Orders 
                SET DeliveryStatus = @Status,
                    Status = @Status 
                WHERE OrderID = @OId AND DeliveryPartnerID = @PId
            `);
        
        if (updateResult.rowsAffected[0] === 0) {
            return res.status(404).json({ message: "Order not found." });
        }

        res.json({ message: "Status updated" });
    } catch (err) {
        console.error("Status Update Error:", err);
        res.status(500).json({ message: 'Error updating status' });
    }
});


// --- NEW: GET PAYOUT HISTORY FOR PARTNER ---
// Add this to your deliveryRoutes.js file
router.get('/my-payouts', authenticatePartner, async (req, res) => {
    try {
        const partnerId = req.user.id;
        const request = new sql.Request();

        // Fetches history from the PartnerPayouts table
        const result = await request
            .input('PartnerId', sql.Int, partnerId)
            .query(`
                SELECT PayoutID, Amount, PayoutDate, ReferenceID
                FROM PartnerPayouts
                WHERE PartnerID = @PartnerId
                ORDER BY PayoutDate DESC
            `);

        res.json(result.recordset);
    } catch (err) {
        console.error("Payout History Error:", err);
        res.status(500).json({ message: 'Error fetching payouts' });
    }
});
// --- SESSION / CLOCK IN-OUT ---
router.post('/update-session-status', authenticatePartner, async (req, res) => {
    const partnerId = req.user.id;
    let transaction;

    try {
        transaction = new sql.Transaction();
        await transaction.begin();
        const request = new sql.Request(transaction);

        const statusRes = await request
            .input('PartnerId', sql.Int, partnerId)
            .query(`SELECT CurrentStatus FROM DeliveryPartners WHERE PartnerID = @PartnerId`);
        
        if (statusRes.recordset.length === 0) {
            await transaction.rollback();
            return res.status(404).json({ message: "Partner not found" });
        }

        const currentStatus = statusRes.recordset[0].CurrentStatus;
        const newTime = new Date();
        let newStatus, message;

        if (currentStatus === 'Online' || currentStatus === 'Busy') {
            newStatus = 'Offline';
            message = 'Clocked out.';
            
            const sessionRes = await new sql.Request(transaction)
                .input('PartnerId', sql.Int, partnerId)
                .query(`SELECT SessionID, LoginTime FROM DeliverySessions WHERE PartnerID = @PartnerId AND LogoutTime IS NULL`);
            
            if (sessionRes.recordset.length > 0) {
                const sessionId = sessionRes.recordset[0].SessionID;
                const loginTime = sessionRes.recordset[0].LoginTime;
                const durationMinutes = Math.floor((newTime.getTime() - new Date(loginTime).getTime()) / 60000);

                await new sql.Request(transaction)
                    .input('SessionID', sql.Int, sessionId)
                    .input('LogoutTime', sql.DateTime, newTime)
                    .input('Duration', sql.Int, durationMinutes)
                    .query(`UPDATE DeliverySessions SET LogoutTime = @LogoutTime, DurationMinutes = @Duration WHERE SessionID = @SessionID`);
            }
        } else {
            newStatus = 'Online';
            message = 'Clocked in.';
            
            await new sql.Request(transaction)
                .input('PartnerId', sql.Int, partnerId)
                .input('LoginTime', sql.DateTime, newTime)
                .query(`INSERT INTO DeliverySessions (PartnerID, LoginTime) VALUES (@PartnerId, @LoginTime)`);
        }

        await new sql.Request(transaction)
            .input('PartnerId', sql.Int, partnerId)
            .input('Status', sql.NVarChar, newStatus)
            .query(`UPDATE DeliveryPartners SET CurrentStatus = @Status WHERE PartnerID = @PartnerId`);
        
        await transaction.commit();
        res.json({ message, newStatus });

    } catch (err) {
        if (transaction) await transaction.rollback();
        console.error("Session Error:", err);
        res.status(500).json({ message: 'Failed to update status' });
    }
});

module.exports = router;