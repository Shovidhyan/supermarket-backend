const express = require('express');
const router = express.Router();
const { sql } = require('../db');
const authenticateToken = require('../middleware/authMiddleware');

// Only authenticated admins should access these insights
router.use(authenticateToken);

// ==========================================
// 1. DASHBOARD ANALYSIS (Charts & Alerts)
// ==========================================
router.get('/dashboard-analysis', async (req, res) => {
    try {
        // Sales Velocity
        const salesVelocity = await sql.query`
            SELECT TOP 5 p.Name, SUM(oi.Quantity) as TotalSold, p.StockQuantity, p.Category
            FROM OrderItems oi
            JOIN Products p ON oi.ProductID = p.ProductID
            JOIN Orders o ON oi.OrderID = o.OrderID
            WHERE o.Status != 'Cancelled'
            GROUP BY p.Name, p.StockQuantity, p.Category
            ORDER BY TotalSold DESC`;

        // Restock Insights
        const restockNeeds = await sql.query`
            SELECT Name, StockQuantity, Category,
                CASE 
                    WHEN StockQuantity <= 5 THEN 'Critical'
                    WHEN StockQuantity <= 15 THEN 'Low Stock'
                    ELSE 'Monitor'
                END as Urgency
            FROM Products 
            WHERE IsActive = 1 AND StockQuantity <= 15
            ORDER BY StockQuantity ASC`;

        res.json({
            topSellers: salesVelocity.recordset,
            restockAlerts: restockNeeds.recordset,
            generatedAt: new Date()
        });
    } catch (err) {
        console.error("AI Insights Error:", err);
        res.status(500).json({ error: 'Failed to generate insights' });
    }
});

// ==========================================
// 2. AGENT SUMMARY (Logs & Spending)
// ==========================================
router.get('/agent-summary', async (req, res) => {
    try {
        const statsQuery = `
            SELECT ISNULL(SUM(Cost), 0) as TotalSpent, ISNULL(SUM(Quantity), 0) as TotalRestocked, COUNT(*) as TotalActions
            FROM AgentLogs 
            WHERE Timestamp >= DATEADD(day, -7, GETDATE()) AND Status = 'SUCCESS'
        `;
        const stats = await sql.query(statsQuery);

        const logsQuery = `SELECT TOP 10 * FROM AgentLogs ORDER BY Timestamp DESC`;
        const logs = await sql.query(logsQuery);

        res.json({
            summary: stats.recordset[0],
            recentLogs: logs.recordset
        });
    } catch (err) {
        console.error("Agent Stats Error:", err);
        res.json({ summary: { TotalSpent: 0, TotalRestocked: 0, TotalActions: 0 }, recentLogs: [] }); 
    }
});

// ==========================================
// 3. AGENT SETTINGS (Budget & Config)
// ==========================================

// GET Settings
router.get('/agent-settings', async (req, res) => {
    try {
        const result = await sql.query`SELECT * FROM SystemSettings`;
        const settings = {};
        if (result.recordset) {
            result.recordset.forEach(row => settings[row.SettingKey] = row.SettingValue);
        }
        res.json(settings);
    } catch (err) {
        console.error("Settings Fetch Error:", err);
        res.status(500).json({ error: 'Failed to fetch settings' });
    }
});

// UPDATE Settings
router.post('/agent-settings', async (req, res) => {
    const { budget, quantity } = req.body;
    
    if (!budget || !quantity) return res.status(400).json({ error: 'Budget and Quantity are required' });

    try {
        const request = new sql.Request();
        request.input('Budget', sql.VarChar, budget.toString());
        request.input('Qty', sql.VarChar, quantity.toString());

        await request.query(`
            UPDATE SystemSettings SET SettingValue = @Budget WHERE SettingKey = 'AgentBudget';
            UPDATE SystemSettings SET SettingValue = @Qty WHERE SettingKey = 'RestockQuantity';
        `);
        
        res.json({ message: 'Settings updated successfully' });
    } catch (err) {
        console.error("Settings Update Error:", err);
        res.status(500).json({ error: 'Failed to update settings' });
    }
});

module.exports = router;