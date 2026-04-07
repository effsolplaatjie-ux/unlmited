require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const twilio = require('twilio');

const app = express();

// --- 1. FIX CORS POLICY ---
app.use(cors({
    origin: '*', // Allows requests from any location
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type']
}));

app.use(express.json());

// --- 2. IMPROVED DATABASE CONNECTION ---
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 4000,
    ssl: { rejectUnauthorized: false },
    waitForConnections: true,
    connectionLimit: 10,
    enableKeepAlive: true, // Keeps connection from dying
    keepAliveInitialDelay: 10000
});

const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// --- 3. UPDATED ROUTES ---

// Login
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const [rows] = await pool.query('SELECT id, username, role FROM users WHERE username = ? AND password = ?', [username, password]);
        if (rows.length > 0) return res.json({ success: true, user: rows[0] });
        res.status(401).json({ success: false, message: 'Invalid credentials' });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// Create Policy + SMS Notification
app.post('/api/policies', async (req, res) => {
    const { client_name, client_phone, insurance_type } = req.body;
    const policy_number = `UFS-${Date.now()}`;
    try {
        await pool.query('INSERT INTO policies (policy_number, client_name, client_phone, insurance_type) VALUES (?, ?, ?, ?)', [policy_number, client_name, client_phone, insurance_type]);
        
        // SMS Notification
        await twilioClient.messages.create({
            body: `UFS: Hello ${client_name}, your ${insurance_type} policy is active. No: ${policy_number}`,
            from: process.env.TWILIO_PHONE_NUMBER,
            to: client_phone
        });

        res.json({ success: true, policy_number });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// Get Policies
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
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// Manual Reminder
app.post('/api/policies/remind', async (req, res) => {
    const { phone, name } = req.body;
    try {
        await twilioClient.messages.create({
            body: `UFS Reminder: Dear ${name}, please settle your policy payment to stay covered.`,
            from: process.env.TWILIO_PHONE_NUMBER,
            to: phone
        });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server LIVE`));