require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const twilio = require('twilio');

const app = express();

// --- 1. ROBUST CORS CONFIGURATION ---
// This fixes the "No Access-Control-Allow-Origin" error
app.use(cors({
    origin: '*', 
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// --- 2. DATABASE POOL WITH ERROR LOGGING ---
// Status 1 crashes often happen here if DB credentials are wrong
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 4000,
    ssl: { rejectUnauthorized: false }, 
    enableKeepAlive: true,
    waitForConnections: true,
    connectionLimit: 10
});

// Immediate connection test to catch errors early in Render logs
pool.getConnection()
    .then(conn => {
        console.log("✅ Database Connected Successfully");
        conn.release();
    })
    .catch(err => {
        console.error("❌ DATABASE CONNECTION FAILED:", err.message);
    });

const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// --- 3. UPDATED ROUTES WITH TRY/CATCH ---

// Login Route
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const [rows] = await pool.query('SELECT id, username, role FROM users WHERE username = ? AND password = ?', [username, password]);
        if (rows.length > 0) return res.json({ success: true, user: rows[0] });
        res.status(401).json({ success: false, message: 'Invalid credentials' });
    } catch (err) {
        console.error("Login Error:", err);
        res.status(500).json({ success: false, error: "Internal Server Error" });
    }
});

// Create Policy + SMS
// Fixes the 500 errors by adding detailed logging
app.post('/api/policies', async (req, res) => {
    const { client_name, client_phone, insurance_type } = req.body;
    const policy_number = `UFS-${Date.now()}`;
    try {
        await pool.query('INSERT INTO policies (policy_number, client_name, client_phone, insurance_type) VALUES (?, ?, ?, ?)', 
            [policy_number, client_name, client_phone, insurance_type]);
        
        try {
            await twilioClient.messages.create({
                body: `UFS: Hello ${client_name}, your policy is active. No: ${policy_number}`,
                from: process.env.TWILIO_PHONE_NUMBER,
                to: client_phone
            });
        } catch (smsErr) {
            console.error("Twilio SMS failed but policy was saved:", smsErr.message);
        }

        res.json({ success: true, policy_number });
    } catch (err) {
        console.error("Policy Creation Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Manual Payment Reminder
app.post('/api/policies/remind', async (req, res) => {
    const { phone, name } = req.body;
    try {
        await twilioClient.messages.create({
            body: `UFS Reminder: Dear ${name}, please settle your policy payment to stay covered.`,
            from: process.env.TWILIO_PHONE_NUMBER,
            to: phone
        });
        res.json({ success: true });
    } catch (err) {
        console.error("Reminder SMS Error:", err);
        res.status(500).json({ success: false, error: "Failed to send SMS" });
    }
});

// Get Policies
app.get('/api/policies', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM policies ORDER BY created_at DESC');
        res.json({ success: true, data: rows });
    } catch (err) {
        console.error("Fetch Policies Error:", err);
        res.status(500).json({ success: false, error: "Database error" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server Running on port ${PORT}`));