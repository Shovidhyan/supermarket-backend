const express = require('express');
const cors = require('cors');
const path = require('path'); 
const { connectDB } = require('./db');
require('dotenv').config();

// --- Import Routes ---
const authRoutes = require('./routes/auth'); 
const categoryRoutes = require('./routes/categories'); 
const subcategoryRoutes = require('./routes/subcategories'); 
const ProductsRoutes = require('./routes/Products'); // Kept consistent name
const wishlistRoutes = require('./routes/wishlist');
const profileRoutes = require('./routes/profile');
const deliveryRoutes = require('./routes/deliveryRoutes');
const inventoryRoutes = require('./routes/inventory');
const aiinsightsRoutes = require('./routes/aiinsights'); // <-- This handles your Agent Dashboard data
const addressRoutes = require('./routes/address'); 
const cartRoutes = require('./routes/cart');
const orderRoutes = require('./routes/orders'); 
const couponRoutes = require('./routes/coupons');
const bannerRoutes = require('./routes/banners');
const configRoutes = require('./routes/config');
const billingRoutes = require('./routes/billing');


// --- Import Controllers ---
const dealController = require('./controllers/deal-controller'); 

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// --- Register API Routes ---
app.use('/api/auth', authRoutes); 
app.use('/api/categories', categoryRoutes);
app.use('/api/subcategories', subcategoryRoutes);
app.use('/api/products', ProductsRoutes); // Registered only once now
app.use('/api/wishlist', wishlistRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/delivery', deliveryRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/aiinsights', aiinsightsRoutes); // Serves the "Smart Agent" panel
app.use('/api/address', addressRoutes); 
app.use('/api/cart', cartRoutes); 
app.use('/api/orders', orderRoutes);
app.use('/api/banners', bannerRoutes);
app.use('/api/config', configRoutes);
app.use('/api/billing', billingRoutes);


// --- Standalone Controller Routes ---
app.get('/api/deals/products', dealController.getAllProducts); 
app.get('/api/deals/active', dealController.getActiveDeals);   
app.post('/api/deals/create', dealController.createDeal);      
app.delete('/api/deals/delete/:id', dealController.deleteDeal); 
app.get('/api/stocks', dealController.getAllProductStocks);

// Base Route
app.get('/', (req, res) => {
    res.send('Supermarket API is running...');
});

// Start Server
const startServer = async () => {
    try {
        await connectDB();
        const server = app.listen(PORT, () => {
            console.log(`🚀 Server running on port ${PORT}`);
        });

        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                console.error(`❌ Port ${PORT} is already in use.`);
            } else {
                console.error('❌ Server Error:', err);
            }
            process.exit(1);
        });
    } catch (err) {
        console.error('❌ Failed to start server:', err);
        process.exit(1);
    }
};

startServer();

// Keep process alive
setInterval(() => {
    // console.log('Keep-alive check...');
}, 60000);

// Handle Unhandled Rejections and Exceptions
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});