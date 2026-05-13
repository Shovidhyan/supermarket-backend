const { sql } = require('../db');

exports.createBill = async (req, res) => {
    try {
        const { CustomerName, CustomerPhone, Items, SubTotal, CGST, SGST, TotalAmount, PaymentMode, CashAmount, UPIAmount } = req.body;

        if (!Items || Items.length === 0) {
            return res.status(400).json({ error: 'Items are required to create a bill.' });
        }

        const ItemsJSON = JSON.stringify(Items);

        const request = new sql.Request();
        request.input('CustomerName', sql.NVarChar(150), CustomerName || '');
        request.input('CustomerPhone', sql.NVarChar(20), CustomerPhone || '');
        request.input('ItemsJSON', sql.NVarChar(sql.MAX), ItemsJSON);
        request.input('SubTotal', sql.Decimal(18, 2), SubTotal);
        request.input('CGST', sql.Decimal(18, 2), CGST);
        request.input('SGST', sql.Decimal(18, 2), SGST);
        request.input('TotalAmount', sql.Decimal(18, 2), TotalAmount);
        request.input('PaymentMode', sql.NVarChar(50), PaymentMode);
        request.input('CashAmount', sql.Decimal(18, 2), CashAmount || 0);
        request.input('UPIAmount', sql.Decimal(18, 2), UPIAmount || 0);

        const result = await request.query(`
            INSERT INTO [dbo].[GSTBills] 
            (CustomerName, CustomerPhone, ItemsJSON, SubTotal, CGST, SGST, TotalAmount, PaymentMode, CashAmount, UPIAmount) 
            OUTPUT INSERTED.BillID
            VALUES 
            (@CustomerName, @CustomerPhone, @ItemsJSON, @SubTotal, @CGST, @SGST, @TotalAmount, @PaymentMode, @CashAmount, @UPIAmount)
        `);

        res.status(201).json({ message: 'Bill created successfully', billId: result.recordset[0].BillID });
    } catch (error) {
        console.error('Error creating bill:', error);
        res.status(500).json({ error: 'Internal server error while creating bill' });
    }
};

exports.getBills = async (req, res) => {
    try {
        const result = await new sql.Request().query(`
            SELECT * FROM [dbo].[GSTBills] ORDER BY CreatedAt DESC
        `);
        res.status(200).json(result.recordset);
    } catch (error) {
        console.error('Error fetching bills:', error);
        res.status(500).json({ error: 'Internal server error while fetching bills' });
    }
};

exports.getCustomerByPhone = async (req, res) => {
    try {
        const { phone } = req.params;
        const result = await new sql.Request()
            .input('phone', sql.NVarChar(20), phone)
            .query(`
                SELECT TOP 1 CustomerName FROM [dbo].[GSTBills] 
                WHERE CustomerPhone = @phone 
                ORDER BY CreatedAt DESC
            `);
        
        if (result.recordset.length > 0) {
            res.status(200).json(result.recordset[0]);
        } else {
            res.status(404).json({ message: 'Customer not found' });
        }
    } catch (error) {
        console.error('Error lookup customer:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
