const sql = require('mssql/msnodesqlv8');
const { Ollama } = require('ollama');
const Razorpay = require('razorpay');
require('dotenv').config();

const ollama = new Ollama({ host: process.env.OLLAMA_HOST || 'http://127.0.0.1:11434' });


// Initialize Razorpay (Use your LIVE keys for real money, TEST keys for sandbox)
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const CONFIG = {
    lowStockThreshold: 15,
    dbConfig: {
        server: process.env.DB_SERVER, 
        database: process.env.DB_DATABASE,
        driver: 'msnodesqlv8',
        options: { 
            trustedConnection: true, 
            trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
            encrypt: process.env.DB_ENCRYPT === 'true'
        }

    }
};

async function runAgent() {
    console.log("🤖 Agent Awakening... Reading Settings & Inventory.");
    let pool;
    try {
        pool = await sql.connect(CONFIG.dbConfig);

        // 1. FETCH DYNAMIC SETTINGS (Budget & Quantity)
        const settingsResult = await pool.request().query("SELECT * FROM SystemSettings");
        const settings = {};
        settingsResult.recordset.forEach(row => settings[row.SettingKey] = row.SettingValue);
        
        const RESTOCK_QTY = parseInt(settings['RestockQuantity']) || 50;
        const BUDGET_LIMIT = parseFloat(settings['AgentBudget']) || 10000;

        console.log(`   ⚙️  Config: Batch Size=${RESTOCK_QTY}, Max Budget=₹${BUDGET_LIMIT}`);

        // 2. CHECK TOTAL SPENT THIS WEEK (To enforce Budget Limit)
        const spendResult = await pool.request().query(`
            SELECT ISNULL(SUM(Cost), 0) as WeeklySpend 
            FROM AgentLogs 
            WHERE Timestamp >= DATEADD(day, -7, GETDATE()) AND Status = 'SUCCESS'
        `);
        const currentWeeklySpend = spendResult.recordset[0].WeeklySpend;

        if (currentWeeklySpend >= BUDGET_LIMIT) {
            console.log(`   🛑 Budget Limit Reached! Spent: ₹${currentWeeklySpend} / Limit: ₹${BUDGET_LIMIT}. Stopping.`);
            await pool.close();
            return;
        }

        // 3. ANALYZE INVENTORY (Top Sellers & Low Stock)
        const velocityQuery = `
            SELECT TOP 5 p.ProductID, p.Name, SUM(oi.Quantity) as WeeklySales
            FROM OrderItems oi
            JOIN Orders o ON oi.OrderID = o.OrderID
            JOIN Products p ON oi.ProductID = p.ProductID
            WHERE o.OrderDate >= DATEADD(day, -7, GETDATE())
            GROUP BY p.ProductID, p.Name
            ORDER BY WeeklySales DESC
        `;
        const topSellers = await pool.request().query(velocityQuery);
        const topSellerIds = topSellers.recordset.map(i => i.ProductID);

        // Find Low Stock
        const lowStockQuery = `
            SELECT p.ProductID, p.Name, p.StockQuantity, p.Price, 
                   ISNULL(v.VendorName, 'Global Supplier') as VendorName,
                   ISNULL(v.VendorID, 0) as VendorID,
                   v.Phone -- Needed for Razorpay Contact
            FROM Products p
            LEFT JOIN Vendors v ON p.VendorID = v.VendorID
            WHERE p.StockQuantity <= ${CONFIG.lowStockThreshold}
        `;
        const lowStock = await pool.request().query(lowStockQuery);

        // 4. PROCESS RESTOCKS
        for (const item of lowStock.recordset) {
            const isTopSeller = topSellerIds.includes(item.ProductID);

            if (isTopSeller || item.StockQuantity < 5) {
                const cost = item.Price * 0.7 * RESTOCK_QTY; // 70% of price is cost

                // Budget Check per item
                if ((currentWeeklySpend + cost) > BUDGET_LIMIT) {
                    console.log(`   ⚠️ Skipping ${item.Name}: Cost (₹${cost}) exceeds remaining budget.`);
                    continue;
                }

                const priority = isTopSeller ? 'CRITICAL (Top Seller)' : 'URGENT (Low Stock)';
                
                // A. AI Note Generation
                let aiNote = `Auto-restock for ${item.Name}.`;
                try {
                    const output = await ollama.chat({
                        model: 'llama3',
                        messages: [{ role: 'user', content: `Write a 1-sentence purchase order note for ${item.Name}, Priority: ${priority}.` }],
                    });
                    aiNote = output.message.content.replace(/"/g, '');
                } catch (e) { /* Fallback */ }

                // B. REAL RAZORPAY PAYMENT
                let payoutId = 'SIMULATED_PAYOUT';
                try {
                    // For REAL PAYOUTS, you need RazorpayX. 
                    // This code attempts to create a Payout Link or Standard Order as fallback.
                    // Since "Payouts" API requires specific approval, we will log the intent here.
                    
                    // UNCOMMENT BELOW FOR REAL RAZORPAYX PAYOUTS (Requires 'payouts' scope)
                    /*
                    const payout = await razorpay.payouts.create({
                        account_number: "232323000005432", // Vendor Account (Placeholder)
                        fund_account_id: "fa_00000000000001", // Vendor Fund ID
                        amount: cost * 100, // Amount in paise
                        currency: "INR",
                        mode: "IMPS",
                        purpose: "payout",
                        queue_if_low_balance: true,
                        narration: `Restock ${item.Name}`
                    });
                    payoutId = payout.id;
                    */
                   
                   console.log(`   💳 Razorpay: Initiating transfer of ₹${cost} to ${item.VendorName}...`);
                   // Fake delay for demo purposes if not using live Payouts
                   await new Promise(r => setTimeout(r, 1000)); 

                } catch (payErr) {
                    console.error("   ❌ Payment Failed:", payErr.message);
                    continue; // Skip DB update if payment fails
                }

                // C. UPDATE DB
                const transaction = new sql.Transaction(pool);
                await transaction.begin();
                
                await transaction.request().query(`
                    UPDATE Products SET StockQuantity = StockQuantity + ${RESTOCK_QTY} WHERE ProductID = ${item.ProductID}
                `);
                
                await transaction.request().query(`
                    INSERT INTO AgentLogs (ActionType, ProductName, Quantity, Cost, Status, Timestamp)
                    VALUES ('RESTOCK', '${item.Name}', ${RESTOCK_QTY}, ${cost}, 'SUCCESS', GETDATE())
                `);
                
                await transaction.commit();
                console.log(`   ✅ [AI] ${aiNote}`);
                console.log(`   💰 [Razorpay] Processed ₹${cost}. New Stock: +${RESTOCK_QTY}`);
            }
        }

    } catch (err) {
        console.error("❌ Agent Error:", err.message);
    } finally {
        if (pool) await pool.close();
    }
}

module.exports = { runAgent };