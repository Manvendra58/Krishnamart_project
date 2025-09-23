const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 5000;
require('dotenv').config();

const { initFirebaseAdmin } = require('./firebaseAdmin');
const admin = initFirebaseAdmin();
const db = admin.firestore();

// Middleware
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.static(__dirname));

// Authentication Middleware (Firebase ID Token)
async function authenticateToken(req, res, next) {
    try {
        const authHeader = req.headers.authorization || '';
        const token = authHeader.startsWith('Bearer ')
            ? authHeader.substring(7)
            : authHeader || null;
        if (!token) {
            return res.status(401).json({ message: 'Access denied' });
        }
        const decoded = await admin.auth().verifyIdToken(token);
        req.user = { id: decoded.uid, email: decoded.email || null };
        next();
    } catch (err) {
        return res.status(403).json({ message: 'Invalid token' });
    }
}

// Auth Routes (Firebase-based)
app.get('/api/auth/me', authenticateToken, async (req, res) => {
    try {
        const userDoc = await db.collection('users').doc(req.user.id).get();
        const userData = userDoc.exists ? userDoc.data() : {};
        res.json({
            id: req.user.id,
            email: req.user.email,
            ...userData
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Get all products (Firestore)
app.get('/api/products', async (req, res) => {
    try {
        const { category, sort } = req.query;
        let snapshot = await db.collection('products').get();
        let products = snapshot.docs.map(d => {
            const data = d.data();
            const createdAt = data.createdAt && typeof data.createdAt.toMillis === 'function'
                ? data.createdAt.toMillis()
                : data.createdAt || 0;
            return { id: d.id, ...data, createdAt };
        });
        if (category) {
            products = products.filter(p => p.category === category);
        }
        if (sort === 'price-low') {
            products.sort((a, b) => (a.price || 0) - (b.price || 0));
        } else if (sort === 'price-high') {
            products.sort((a, b) => (b.price || 0) - (a.price || 0));
        } else {
            products.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        }
        res.json({ success: true, products });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Error fetching products', message: error.message });
    }
});

app.post('/api/products', async (req, res) => {
    try {
        const product = { ...req.body, createdAt: Date.now() };
        const ref = await db.collection('products').add(product);
        const saved = { id: ref.id, ...product };
        res.status(201).json(saved);
    } catch (error) {
        res.status(400).json({ error: 'Error creating product', details: error.message });
    }
});

app.put('/api/products/:id', async (req, res) => {
    try {
        const ref = db.collection('products').doc(req.params.id);
        const exists = await ref.get();
        if (!exists.exists) return res.status(404).json({ error: 'Product not found' });
        await ref.update({ ...req.body, updatedAt: Date.now() });
        const updated = await ref.get();
        res.json({ id: updated.id, ...updated.data() });
    } catch (error) {
        res.status(400).json({ error: 'Error updating product', details: error.message });
    }
});

app.get('/api/products/featured', async (req, res) => {
    try {
        const snapshot = await db.collection('products').orderBy('createdAt', 'desc').limit(4).get();
        const products = snapshot.docs.map(d => {
            const data = d.data();
            const createdAt = data.createdAt && typeof data.createdAt.toMillis === 'function'
                ? data.createdAt.toMillis()
                : data.createdAt || 0;
            return { id: d.id, ...data, createdAt };
        });
        res.json(products);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Category Routes (Firestore collection: categories)
app.get('/api/categories', async (req, res) => {
    try {
        const snapshot = await db.collection('categories').get();
        const categories = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        res.json(categories);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Order Routes
app.post('/api/orders', authenticateToken, async (req, res) => {
    try {
        const { items, shippingAddress, paymentMethod } = req.body;
        const totalAmount = items.reduce((total, item) => total + ((item.price || 0) * (item.quantity || 1)), 0);
        const order = {
            orderId: `ORD-${Date.now()}`,
            userId: req.user.id,
            items,
            totalAmount,
            shippingAddress,
            paymentMethod,
            status: 'pending',
            paymentStatus: 'pending',
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        const ref = await db.collection('orders').add(order);
        // Clear user's cart
        await db.collection('users').doc(req.user.id).set({ cart: [] }, { merge: true });
        res.status(201).json({ success: true, message: 'Order created successfully', order: { id: ref.id, ...order } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error creating order', error: error.message });
    }
});

app.get('/api/orders', authenticateToken, async (req, res) => {
    try {
        const snapshot = await db.collection('orders').where('userId', '==', req.user.id).orderBy('createdAt', 'desc').get();
        const orders = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        res.json({ success: true, orders });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error fetching orders', error: error.message });
    }
});

app.get('/api/orders/:status', async (req, res) => {
    try {
        const snapshot = await db.collection('orders').where('status', '==', req.params.status).get();
        const orders = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        res.json(orders);
    } catch (error) {
        res.status(500).json({ error: 'Error fetching orders' });
    }
});

app.get('/api/order/:orderId', async (req, res) => {
    try {
        const snapshot = await db.collection('orders').where('orderId', '==', req.params.orderId).limit(1).get();
        if (snapshot.empty) return res.status(404).json({ error: 'Order not found' });
        const doc = snapshot.docs[0];
        res.json({ id: doc.id, ...doc.data() });
    } catch (error) {
        res.status(500).json({ error: 'Error fetching order' });
    }
});

app.put('/api/orders/:orderId/status', async (req, res) => {
    try {
        const snapshot = await db.collection('orders').where('orderId', '==', req.params.orderId).limit(1).get();
        if (snapshot.empty) return res.status(404).json({ error: 'Order not found' });
        const doc = snapshot.docs[0];
        await db.collection('orders').doc(doc.id).update({ status: req.body.status, updatedAt: Date.now() });
        const updated = await db.collection('orders').doc(doc.id).get();
        res.json({ id: updated.id, ...updated.data() });
    } catch (error) {
        res.status(500).json({ error: 'Error updating order status' });
    }
});

app.put('/api/orders/:orderId/cancel', async (req, res) => {
    try {
        const snapshot = await db.collection('orders').where('orderId', '==', req.params.orderId).limit(1).get();
        if (snapshot.empty) return res.status(404).json({ error: 'Order not found' });
        const doc = snapshot.docs[0];
        await db.collection('orders').doc(doc.id).update({ status: 'cancelled', updatedAt: Date.now() });
        const updated = await db.collection('orders').doc(doc.id).get();
        res.json({ id: updated.id, ...updated.data() });
    } catch (error) {
        res.status(500).json({ error: 'Error cancelling order' });
    }
});

// User Routes (Firestore)
app.get('/api/users', async (req, res) => {
    try {
        const snapshot = await db.collection('users').get();
        const users = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        res.json(users);
    } catch (error) {
        res.status(500).json({ error: 'Error fetching users' });
    }
});

app.get('/api/users/:id', async (req, res) => {
    try {
        const doc = await db.collection('users').doc(req.params.id).get();
        if (!doc.exists) return res.status(404).json({ error: 'User not found' });
        res.json({ id: doc.id, ...doc.data() });
    } catch (error) {
        res.status(404).json({ error: 'User not found' });
    }
});

app.put('/api/users/:id', async (req, res) => {
    try {
        await db.collection('users').doc(req.params.id).set(req.body, { merge: true });
        const updated = await db.collection('users').doc(req.params.id).get();
        res.json({ id: updated.id, ...updated.data() });
    } catch (error) {
        res.status(400).json({ error: 'Error updating user' });
    }
});

app.delete('/api/users/:id', async (req, res) => {
    try {
        await db.collection('users').doc(req.params.id).delete();
        res.status(204).send();
    } catch (error) {
        res.status(400).json({ error: 'Error deleting user' });
    }
});

// Newsletter subscription
app.post('/api/newsletter', async (req, res) => {
    try {
        const { email } = req.body;
        // Here you would typically save the email to your database
        res.json({ message: 'Successfully subscribed to newsletter' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Cart Routes (user document has array field: cart)
app.post('/api/cart/add', authenticateToken, async (req, res) => {
    try {
        const { productId, quantity } = req.body;
        const userRef = db.collection('users').doc(req.user.id);
        const doc = await userRef.get();
        const userData = doc.exists ? doc.data() : {};
        const cart = Array.isArray(userData.cart) ? userData.cart : [];
        const idx = cart.findIndex(item => item.productId === productId);
        if (idx >= 0) {
            cart[idx].quantity = (cart[idx].quantity || 1) + (quantity || 1);
        } else {
            cart.push({ productId, quantity: quantity || 1, addedAt: Date.now() });
        }
        await userRef.set({ cart }, { merge: true });
        res.json({ success: true, message: 'Product added to cart', cart });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error adding to cart', error: error.message });
    }
});

app.get('/api/cart', authenticateToken, async (req, res) => {
    try {
        const doc = await db.collection('users').doc(req.user.id).get();
        const userData = doc.exists ? doc.data() : {};
        const cart = Array.isArray(userData.cart) ? userData.cart : [];
        res.json({ success: true, cart });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error fetching cart', error: error.message });
    }
});

app.delete('/api/cart/:productId', authenticateToken, async (req, res) => {
    try {
        const userRef = db.collection('users').doc(req.user.id);
        const doc = await userRef.get();
        const userData = doc.exists ? doc.data() : {};
        const cart = (Array.isArray(userData.cart) ? userData.cart : []).filter(item => item.productId !== req.params.productId);
        await userRef.set({ cart }, { merge: true });
        res.json({ success: true, message: 'Product removed from cart', cart });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error removing from cart', error: error.message });
    }
});

// Dashboard Routes
app.get('/api/dashboard', authenticateToken, async (req, res) => {
    try {
        const userDoc = await db.collection('users').doc(req.user.id).get();
        const cart = (userDoc.exists && Array.isArray(userDoc.data().cart)) ? userDoc.data().cart : [];
        const ordersSnap = await db.collection('orders').where('userId', '==', req.user.id).orderBy('createdAt', 'desc').get();
        const orders = ordersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        res.json({ cart, orders });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Update user profile
app.put('/api/users/profile', authenticateToken, async (req, res) => {
    try {
        const { name, email, phone } = req.body;
        await db.collection('users').doc(req.user.id).set({ name, email, phone }, { merge: true });
        res.json({ message: 'Profile updated successfully' });
    } catch (error) {
        res.status(400).json({ error: 'Error updating profile' });
    }
});

// Update user address
app.put('/api/users/address', authenticateToken, async (req, res) => {
    try {
        const { type, street, city, state, zipCode, country } = req.body;
        const userRef = db.collection('users').doc(req.user.id);
        const doc = await userRef.get();
        const userData = doc.exists ? doc.data() : {};
        const addresses = Array.isArray(userData.addresses) ? userData.addresses : [];
        const idx = addresses.findIndex(a => a.type === type);
        const newAddress = { type, street, city, state, zipCode, country };
        if (idx >= 0) addresses[idx] = newAddress; else addresses.push(newAddress);
        await userRef.set({ addresses }, { merge: true });
        res.json({ message: 'Address updated successfully' });
    } catch (error) {
        res.status(400).json({ error: 'Error updating address' });
    }
});

// Change password
app.put('/api/users/password', authenticateToken, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const user = await User.findById(req.user.id);
        
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Verify current password
        const validPassword = await bcrypt.compare(currentPassword, user.password);
        if (!validPassword) {
            return res.status(400).json({ message: 'Current password is incorrect' });
        }

        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        user.password = hashedPassword;
        
        await user.save();
        res.json({ message: 'Password updated successfully' });
    } catch (error) {
        res.status(400).json({ error: 'Error updating password' });
    }
});

// Check database status
app.get('/api/status', async (req, res) => {
    try {
        const productsSnap = await db.collection('products').get();
        const categories = Array.from(new Set(productsSnap.docs.map(d => d.data().category).filter(Boolean)));
        res.json({
            success: true,
            database: {
                connected: true,
                productCount: productsSnap.size,
                categories
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Error checking database status', message: error.message });
    }
});

// Address Routes
app.post('/api/addresses', authenticateToken, async (req, res) => {
    try {
        const { type, street, city, state, zipCode, country } = req.body;
        
        // Validate required fields
        if (!type || !street || !city || !state || !zipCode || !country) {
            return res.status(400).json({
                success: false,
                message: 'All address fields are required'
            });
        }

        const userRef = db.collection('users').doc(req.user.id);
        const doc = await userRef.get();
        const data = doc.exists ? doc.data() : {};
        const addresses = Array.isArray(data.addresses) ? data.addresses : [];
        if (addresses.find(a => a.type === type)) {
            return res.status(400).json({ success: false, message: 'Address type already exists' });
        }
        addresses.push({ type, street, city, state, zipCode, country });
        await userRef.set({ addresses }, { merge: true });
        res.json({ success: true, message: 'Address added successfully', addresses });
    } catch (error) {
        console.error('Error adding address:', error);
        res.status(500).json({
            success: false,
            message: 'Error adding address',
            error: error.message
        });
    }
});

app.get('/api/addresses', authenticateToken, async (req, res) => {
    try {
        const doc = await db.collection('users').doc(req.user.id).get();
        const data = doc.exists ? doc.data() : {};
        res.json({ success: true, addresses: Array.isArray(data.addresses) ? data.addresses : [] });
    } catch (error) {
        console.error('Error fetching addresses:', error);
        res.status(500).json({ success: false, message: 'Error fetching addresses', error: error.message });
    }
});

app.delete('/api/addresses/:type', authenticateToken, async (req, res) => {
    try {
        const { type } = req.params;
        const userRef = db.collection('users').doc(req.user.id);
        const doc = await userRef.get();
        const data = doc.exists ? doc.data() : {};
        const addresses = (Array.isArray(data.addresses) ? data.addresses : []).filter(a => a.type !== type);
        await userRef.set({ addresses }, { merge: true });
        res.json({ success: true, message: 'Address deleted successfully', addresses });
    } catch (error) {
        console.error('Error deleting address:', error);
        res.status(500).json({ success: false, message: 'Error deleting address', error: error.message });
    }
});

// Payment Routes (mock)
app.post('/api/payments/create-order', authenticateToken, async (req, res) => {
    try {
        const { amount, currency = 'INR', items } = req.body;
        
        // Validate required fields
        if (!amount || !items || !Array.isArray(items)) {
            return res.status(400).json({
                success: false,
                message: 'Amount and items are required'
            });
        }

        // Here you would typically integrate with a payment gateway
        // For this example, we'll create a mock order
        const order = {
            orderId: `ORD-${Date.now()}`,
            amount,
            currency,
            items,
            status: 'pending',
            createdAt: new Date()
        };

        await db.collection('orders').add({ userId: req.user.id, ...order });

        res.json({
            success: true,
            order,
            message: 'Order created successfully'
        });
    } catch (error) {
        console.error('Error creating order:', error);
        res.status(500).json({
            success: false,
            message: 'Error creating order',
            error: error.message
        });
    }
});

app.post('/api/payments/verify', authenticateToken, async (req, res) => {
    try {
        const { orderId, paymentId, signature } = req.body;
        
        // Validate required fields
        if (!orderId || !paymentId) {
            return res.status(400).json({
                success: false,
                message: 'Order ID and Payment ID are required'
            });
        }

        // Here you would typically verify the payment with your payment gateway
        // For this example, we'll simulate a successful payment
        const snap = await db.collection('orders').where('orderId', '==', orderId).limit(1).get();
        if (snap.empty) return res.status(404).json({ success: false, message: 'Order not found' });
        const doc = snap.docs[0];
        const order = { ...doc.data(), status: 'completed', paymentId, completedAt: Date.now() };
        await db.collection('orders').doc(doc.id).set(order, { merge: true });
        res.json({ success: true, order, message: 'Payment verified successfully' });
    } catch (error) {
        console.error('Error verifying payment:', error);
        res.status(500).json({
            success: false,
            message: 'Error verifying payment',
            error: error.message
        });
    }
});

app.get('/api/payments/orders', authenticateToken, async (req, res) => {
    try {
        const snapshot = await db.collection('orders').where('userId', '==', req.user.id).get();
        const orders = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        res.json({ success: true, orders });
    } catch (error) {
        console.error('Error fetching orders:', error);
        res.status(500).json({ success: false, message: 'Error fetching orders', error: error.message });
    }
});

// User Information Routes
app.put('/api/user/info', authenticateToken, async (req, res) => {
    try {
        const { addresses, phone, preferences } = req.body;
        const info = { addresses, phone, preferences };
        await db.collection('users').doc(req.user.id).set({ info }, { merge: true });
        const doc = await db.collection('users').doc(req.user.id).get();
        res.json({ success: true, message: 'User information updated successfully', info: doc.data().info || info });
    } catch (error) {
        console.error('Error updating user info:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating user information',
            error: error.message
        });
    }
});

app.get('/api/user/info', authenticateToken, async (req, res) => {
    try {
        const doc = await db.collection('users').doc(req.user.id).get();
        const info = doc.exists ? (doc.data().info || {}) : {};
        res.json({ success: true, info });
    } catch (error) {
        console.error('Error fetching user info:', error);
        res.status(500).json({ success: false, message: 'Error fetching user information', error: error.message });
    }
});

// User Data API Endpoints
app.get('/api/user/data', authenticateToken, async (req, res) => {
    try {
        const userDoc = await db.collection('users').doc(req.user.id).get();
        const user = userDoc.exists ? userDoc.data() : {};
        const ordersSnap = await db.collection('orders').where('userId', '==', req.user.id).get();
        const orders = ordersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const cart = Array.isArray(user.cart) ? user.cart : [];
        res.json({ userData: { name: user.name, email: user.email, username: user.username, info: user.info }, orders, cart });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching user data' });
    }
});

app.post('/api/user/data/update', authenticateToken, async (req, res) => {
    try {
        const { name, email, info } = req.body;
        const user = await User.findById(req.user.id);

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        if (name) user.name = name;
        if (email) user.email = email;
        if (info) user.info = info;

        await user.save();
        res.json({ message: 'User data updated successfully', user: user });
    } catch (error) {
        console.error('Error updating user data:', error);
        res.status(500).json({ message: 'Error updating user data' });
    }
});

app.get('/api/user/orders', authenticateToken, async (req, res) => {
    try {
        const ordersSnap = await db.collection('orders').where('userId', '==', req.user.id).get();
        const orders = ordersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        res.json(orders);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching user orders' });
    }
});

app.get('/api/user/cart', authenticateToken, async (req, res) => {
    try {
        const doc = await db.collection('users').doc(req.user.id).get();
        const user = doc.exists ? doc.data() : {};
        res.json(Array.isArray(user.cart) ? user.cart : []);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching user cart' });
    }
});

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});
// Note: Admin-specific routes were removed with MongoDB. Implement Firebase-based admin if needed.

// Error handling for server
const server = app.listen(PORT, '0.0.0.0', (error) => {
    if (error) {
        console.error('Error starting server:', error);
        process.exit(1);
    }
    console.log(`Server is running on port ${PORT}`);
});

// Handle server errors
server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use. Please try a different port.`);
    } else {
        console.error('Server error:', error);
    }
    process.exit(1);
});

// Handle process termination
process.on('SIGTERM', () => {
    console.log('SIGTERM received. Shutting down gracefully...');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});