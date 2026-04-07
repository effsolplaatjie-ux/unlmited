require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const twilio = require('twilio');

const app = express();
app.use(cors());
app.use(express.json());

// ==========================================
// CONFIGURATION & DATABASE CONNECTION
// ==========================================
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 4000, // TiDB Default
    waitForConnections: true,
    connectionLimit: 10
});

const twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID, 
    process.env.TWILIO_AUTH_TOKEN
);

// Helper: Generate Unique Policy Number
const generatePolicyNumber = () => {
    const year = new Date().getFullYear();
    const random = Math.floor(100000 + Math.random() * 900000);
    return `UFS-${year}-${random}`;
};

// Helper: Send SMS
const sendSMS = async (to, message) => {
    try {
        await twilioClient.messages.create({
            body: message,
            from: process.env.TWILIO_PHONE_NUMBER,
            to: to
        });
    } catch (err) {
        console.error("SMS Error:", err.message);
    }
};

// ==========================================
// 1. AUTHENTICATION & STAFF MANAGEMENT
// ==========================================

// Login (Feature 7)
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const [rows] = await pool.query(
            'SELECT * FROM users WHERE username = ? AND password = ?', 
            [username, password]
        );
        if (rows.length > 0) {
            const { password, ...userWithoutPassword } = rows[0];
            res.json({ success: true, user: userWithoutPassword });
        } else {
            res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Add Staff/Employee (Feature 2)
app.post('/api/employees', async (req, res) => {
    const { username, password } = req.body;
    try {
        await pool.query(
            'INSERT INTO users (username, password, role) VALUES (?, ?, "employee")', 
            [username, password]
        );
        res.json({ success: true, message: 'Staff member added successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Username might already exist' });
    }
});

// ==========================================
// 2. POLICY MANAGEMENT
// ==========================================

// Create Policy (Feature 3, 4, 7 & SMS Notification)
app.post('/api/policies', async (req, res) => {
    const { client_name, client_phone, insurance_type } = req.body;
    const policy_number = generatePolicyNumber();

    try {
        await pool.query(
            'INSERT INTO policies (policy_number, client_name, client_phone, insurance_type) VALUES (?, ?, ?, ?)',
            [policy_number, client_name, client_phone, insurance_type]
        );

        // Notify client (Feature 1)
        const msg = `Unlimited Funeral Services: Your ${insurance_type} policy is now active. Policy No: ${policy_number}.`;
        await sendSMS(client_phone, msg);

        res.json({ success: true, policy_number });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Search/List Policies (Feature 5)
app.get('/api/policies', async (req, res) => {
    const { search } = req.query;
    try {
        let sql = 'SELECT * FROM policies';
        let params = [];
        
        if (search) {
            sql += ' WHERE policy_number LIKE ? OR client_name LIKE ?';
            params = [`%${search}%`, `%${search}%`];
        }
        
        sql += ' ORDER BY created_at DESC';
        const [rows] = await pool.query(sql, params);
        res.json({ success: true, data: rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Toggle Paid/Unpaid (Feature 1 & 6)
app.put('/api/policies/:id/status', async (req, res) => {
    const { status } = req.body; // 'paid' or 'unpaid'
    const { id } = req.params;

    try {
        await pool.query('UPDATE policies SET status = ? WHERE id = ?', [status, id]);

        // If marked unpaid, notify of missed payment (Feature 1)
        if (status === 'unpaid') {
            const [rows] = await pool.query('SELECT client_phone FROM policies WHERE id = ?', [id]);
            if (rows.length > 0) {
                await sendSMS(rows[0].client_phone, "Unlimited Funeral Services: Your policy payment is overdue. Please settle to avoid lapse.");
            }
        }
        res.json({ success: true, message: `Status updated to ${status}` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// START SERVER
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));