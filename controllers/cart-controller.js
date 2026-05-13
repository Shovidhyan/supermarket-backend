const { sql } = require('../db');

// --- Helper: Calculate Cart Totals with Deal Prices ---
const _getCartSummaryAndCalculation = async (userId) => {
    // 1. Fetch Cart Items with Deal Price check
    const cartResult = await sql.query`
        SELECT 
            ci.ProductID,
            ci.Quantity,
            p.Price AS OriginalPrice,
            COALESCE(pd.DealPrice, p.Price) AS Price, -- Priority: DealPrice > Price
            p.Name,
            p.ImageURL,
            p.Unit
        FROM CartItems ci
        JOIN Cart c ON ci.CartID = c.CartID
        JOIN Products p ON ci.ProductID = p.ProductID
        -- Join with ProductDeals to check for current active offers
        LEFT JOIN ProductDeals pd ON p.ProductID = pd.ProductID 
            AND pd.IsActive = 1 
            AND pd.EndTime > GETUTCDATE()
        WHERE c.UserID = ${userId}
    `;
    const cartItems = cartResult.recordset;

    if (cartItems.length === 0) {
        return { 
            items: [], 
            calculation: { sellingTotal: 0, dealSavings: 0, couponDiscount: 0, deliveryFee: 0, finalTotal: 0 } 
        };
    }

    // 2. Calculate Totals
    let sellingTotal = 0;
    let dealSavings = 0;
    const items = [];

    for (const item of cartItems) {
        const finalPrice = item.Price; 
        sellingTotal += finalPrice * item.Quantity;
        
        // Track how much is saved compared to original price
        if (item.Price < item.OriginalPrice) {
            dealSavings += (item.OriginalPrice - item.Price) * item.Quantity;
        }

        items.push({
            ProductID: item.ProductID,
            Name: item.Name,
            Quantity: item.Quantity,
            FinalPrice: finalPrice,
            OriginalPrice: item.OriginalPrice,
            IsOnDeal: item.Price < item.OriginalPrice
        });
    }

    // Delivery Fee Logic (Free above 499)
    const deliveryFee = sellingTotal >= 499 ? 0 : 40;
    const finalTotal = sellingTotal + deliveryFee;

    return { 
        items,
        calculation: {
            sellingTotal,
            dealSavings, 
            couponDiscount: 0,
            deliveryFee,
            finalTotal,
        }
    };
};

const cartController = {
    getCartSummary: async (req, res) => {
        const userId = req.user.id;
        try {
            const summary = await _getCartSummaryAndCalculation(userId);
            res.json(summary);
        } catch (error) {
            console.error("Error generating cart summary:", error);
            res.status(500).json({ error: 'Failed to generate cart summary.' });
        }
    },
};

module.exports = cartController;