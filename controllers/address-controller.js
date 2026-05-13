const { sql } = require('../db');

const addressController = {
    
    // ... existing functions (add, update, remove, setDefault) ...

    // --- Fetch ALL Addresses for a User ---
    fetchAddresses: async (req, res) => {
        const userId = req.user.id; // Assuming user ID is extracted from JWT middleware
        try {
            const result = await sql.query`
                SELECT 
                    AddressID, FullAddress, City, State, Pincode, Landmark, IsDefault
                FROM Addresses -- NOTE: Assuming your table is named 'Addresses'
                WHERE UserID = ${userId}
                ORDER BY IsDefault DESC, AddressID DESC
            `;
            res.json(result.recordset);
        } catch (err) {
            console.error("Error fetching addresses:", err);
            res.status(500).json({ error: 'Failed to fetch addresses' });
        }
    },
    
    // --- Fetch Single Default Address (Needed for quick confirmation) ---
    fetchDefaultAddress: async (req, res) => {
        const userId = req.user.id; 
        try {
            const result = await sql.query`
                SELECT 
                    AddressID, FullAddress, City, State, Pincode, Landmark, IsDefault
                FROM Addresses
                WHERE UserID = ${userId} AND IsDefault = 1
            `;
            // Return null if not found, or the address object
            res.json(result.recordset.length > 0 ? result.recordset[0] : null);
        } catch (err) {
            console.error("Error fetching default address:", err);
            res.status(500).json({ error: 'Failed to fetch default address' });
        }
    }
};

module.exports = addressController;