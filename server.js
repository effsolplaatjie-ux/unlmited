require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const twilio = require('twilio');

const app = express();
app.use(cors());
app.use(express.json());

// ==========================================
// DATABASE CONNECTION (With SSL for Cloud/TiDB)
// ==========================================
const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 4000,
    ssl: {
        rejectUnauthorized: false // REQUIRED for TiDB and Render connections
    },
    waitForConnections: true,
    connectionLimit: 10
};

const pool = mysql.createPool(dbConfig);

// DATABASE TESTER: This will print the exact error to your Render logs
pool.getConnection()
    .then(conn => {
        console.log("✅ Database Connected Successfully!");
        conn.release();
    })
    .catch(err => {
        console.error("❌ DATABASE CONNECTION FAILED:", err.message);
    });

const twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID, 
    process.env.TWILIO_AUTH_TOKEN
);

// Helper: Send SMS
const sendSMS = async (to, message) => {
    try {
        await twilioClient.messages.create({
            body: message,
            from: process.env.TWILIO_PHONE_NUMBER,
            to: to
        });
        console.log(`SMS sent to ${to}`);
    } catch (err) {
        console.error("Twilio Error:", err.message);
    }
};

// ==========================================
// 1. AUTHENTICATION
// ==========================================

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const [rows] = await pool.query('SELECT * FROM users WHERE username = ? AND password = ?', [username, password]);
        if (rows.length > 0) {
            const { password, ...user } = rows[0];
            res.json({ success: true, user });
        } else {
            res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: "Database error during login" });
    }
});

// ==========================================
// 2. POLICY MANAGEMENT
// ==========================================

app.post('/api/policies', async (req, res) => {
    const { client_name, client_phone, insurance_type } = req.body;
    const policy_number = `UFS-${Date.now()}`;

    try {
        await pool.query(
            'INSERT INTO policies (policy_number, client_name, client_phone, insurance_type) VALUES (?, ?, ?, ?)',
            [policy_number, client_name, client_phone, insurance_type]
        );
        
        await sendSMS(client_phone, `Unlimited Funeral Services: Your ${insurance_type} policy is active. No: ${policy_number}`);
        
        res.json({ success: true, policy_number });
    } catch (err) {
        res.status(500).json({ success: false, error: "Failed to create policy" });
    }
});

app.get('/api/policies', async (req, res) => {
    const { search } = req.query;
    try {
        let sql = 'SELECT * FROM policies';
        let params = [];
        if (search) {
            sql += ' WHERE policy_number LIKE ? OR client_name LIKE ?';
            params = [`%${search}%`, `%${search}%`];
        }
        const [rows] = await pool.query(sql + ' ORDER BY created_at DESC', params);
        res.json({ success: true, data: rows });
    } catch (err) {
        res.status(500).json({ success: false, error: "Failed to fetch policies" });
    }
});

// NEW: Manual Payment Reminder API
app.post('/api/policies/remind', async (req, res) => {
    const { phone, name } = req.body;
    try {
        const msg = `Dear ${name}, this is a payment reminder from Unlimited Funeral Services. Please ensure your policy remains up to date.`;
        await sendSMS(phone, msg);
        res.json({ success: true, message: "Reminder sent!" });
    } catch (err) {
        res.status(500).json({ success: false, error: "Failed to send reminder" });
    }
});

app.put('/api/policies/:id/status', async (req, res) => {
    const { status } = req.body;
    try {
        await pool.query('UPDATE policies SET status = ? WHERE id = ?', [status, req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server LIVE on port ${PORT}`));