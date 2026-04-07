const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const twilio = require('twilio');
require('dotenv').config();

const app = express();

// --- 1. ROBUST CORS (Fixes pre-flight errors) ---
app.use(cors({
    origin: '*', // Allows access from Netlify and local files
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// --- 2. DATABASE TEST (Checks for connection errors in Render logs) ---
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 4000,
    ssl: { rejectUnauthorized: false },
    enableKeepAlive: true
});

pool.query('SELECT 1').then(() => console.log("✅ Database Connected")).catch(err => console.error("❌ DB Error:", err.message));

const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// --- 3. LOGIN & STAFF ---
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const [rows] = await pool.query('SELECT id, username, role FROM users WHERE username = ? AND password = ?', [username, password]);
        if (rows.length > 0) return res.json({ success: true, user: rows[0] });
        res.status(401).json({ success: false, message: 'Invalid credentials' });
    } catch (err) { res.status(500).json({ success: false, error: "Database error" }); }
});

app.post('/api/employees', async (req, res) => {
    const { username, password } = req.body;
    try {
        await pool.query('INSERT INTO users (username, password, role) VALUES (?, ?, "employee")', [username, password]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: "Username already exists" }); }
});

// --- 4. POLICIES & SMS ---
app.post('/api/policies', async (req, res) => {
    const { client_name, client_phone, insurance_type } = req.body;
    const policy_number = `UFS-${Date.now()}`;
    try {
        await pool.query('INSERT INTO policies (policy_number, client_name, client_phone, insurance_type, status) VALUES (?, ?, ?, ?, "unpaid")', 
            [policy_number, client_name, client_phone, insurance_type]);
        
        const message = `UFS: Hello ${client_name}, your ${insurance_type} policy is active. Policy No: ${policy_number}. Status: UNPAID. Please settle your account.`;
        await twilioClient.messages.create({ body: message, from: process.env.TWILIO_PHONE_NUMBER, to: client_phone });
        
        res.json({ success: true, policy_number });
    } catch (err) { res.status(500).json({ success: false, error: "Policy saved, but SMS failed." }); }
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
    } catch (err) { res.status(500).json({ success: false, error: "Error fetching data" }); }
});

app.put('/api/policies/:id/status', async (req, res) => {
    const { status } = req.body;
    try {
        await pool.query('UPDATE policies SET status = ? WHERE id = ?', [status, req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: "Update failed" }); }
});

app.post('/api/policies/remind', async (req, res) => {
    const { phone, name } = req.body;
    try {
        await twilioClient.messages.create({
            body: `UFS Reminder: Dear ${name}, please settle your policy payment to stay covered. Thank you.`,
            from: process.env.TWILIO_PHONE_NUMBER,
            to: phone
        });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: "SMS Error" }); }
});

// --- 5. PDF CERTIFICATE ROUTE ---
app.get('/api/policies/:id/certificate', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM policies WHERE id = ?', [req.params.id]);
        if (rows.length === 0) return res.status(404).send("Policy not found");
        const p = rows[0];

        const doc = new PDFDocument();
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=UFS_${p.policy_number}.pdf`);
        doc.pipe(res);

        doc.fontSize(25).text('UNLIMITED FUNERAL SERVICES', { align: 'center' });
        doc.moveDown().fontSize(18).text('POLICY CERTIFICATE', { align: 'center' });
        doc.moveDown().fontSize(12);
        doc.text(`Policy Number: ${p.policy_number}`);
        doc.text(`Client Name: ${p.client_name}`);
        doc.text(`Insurance Type: ${p.insurance_type}`);
        doc.text(`Status: ${p.status.toUpperCase()}`);
        doc.text(`Issue Date: ${new Date(p.created_at).toLocaleDateString()}`);
        doc.end();
    } catch (err) { res.status(500).send("PDF Error"); }
});

app.listen(process.env.PORT || 3000, () => console.log("UFS Backend Active"));