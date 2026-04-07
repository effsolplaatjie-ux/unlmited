require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const twilio = require('twilio');
const PDFDocument = require('pdfkit'); // Added for Certificates

const app = express();

// --- 1. CRITICAL CORS & SECURITY FIX ---
app.use(cors({
    origin: '*', 
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type']
}));
app.use(express.json());

// --- 2. DATABASE CONNECTION ---
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 4000,
    ssl: { rejectUnauthorized: false },
    enableKeepAlive: true
});

const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// --- 3. UPDATED ROUTES ---

// Login logic
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const [rows] = await pool.query('SELECT id, username, role FROM users WHERE username = ? AND password = ?', [username, password]);
        if (rows.length > 0) return res.json({ success: true, user: rows[0] });
        res.status(401).json({ success: false, message: 'Invalid credentials' });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// Create Policy + Detailed SMS
app.post('/api/policies', async (req, res) => {
    const { client_name, client_phone, insurance_type } = req.body;
    const policy_number = `UFS-${Date.now()}`;
    try {
        // Insert with 'unpaid' status by default
        await pool.query('INSERT INTO policies (policy_number, client_name, client_phone, insurance_type, status) VALUES (?, ?, ?, ?, "unpaid")', 
            [policy_number, client_name, client_phone, insurance_type]);
        
        // SMS with full details as requested
        await twilioClient.messages.create({
            body: `Unlimited Funeral Services: Hello ${client_name}, your ${insurance_type} policy is active. Policy No: ${policy_number}. Status: UNPAID. Please settle your payment.`,
            from: process.env.TWILIO_PHONE_NUMBER,
            to: client_phone
        });
        res.json({ success: true, policy_number });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// Update Policy Status (Paid/Unpaid)
app.put('/api/policies/:id/status', async (req, res) => {
    const { status } = req.body;
    try {
        await pool.query('UPDATE policies SET status = ? WHERE id = ?', [status, req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// Fetch All Policies
app.get('/api/policies', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM policies ORDER BY created_at DESC');
        res.json({ success: true, data: rows });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// --- 4. NEW: GENERATE & DOWNLOAD CERTIFICATE ---
app.get('/api/policies/:id/certificate', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM policies WHERE id = ?', [req.params.id]);
        if (rows.length === 0) return res.status(404).send("Policy not found");
        const p = rows[0];

        const doc = new PDFDocument();
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=Certificate_${p.policy_number}.pdf`);
        doc.pipe(res);

        // Certificate Design
        doc.fontSize(22).text('UNLIMITED FUNERAL SERVICES', { align: 'center' });
        doc.moveDown().fontSize(16).text('CERTIFICATE OF COVERAGE', { align: 'center' });
        doc.moveDown().fontSize(12);
        doc.text(`Policy Number: ${p.policy_number}`);
        doc.text(`Holder Name: ${p.client_name}`);
        doc.text(`Contact: ${p.client_phone}`);
        doc.text(`Insurance Type: ${p.insurance_type}`);
        doc.text(`Status: ${p.status.toUpperCase()}`);
        doc.text(`Issue Date: ${new Date(p.created_at).toLocaleDateString()}`);
        doc.moveDown().text('This document serves as proof of insurance coverage.', { align: 'center', oblique: true });
        
        doc.end();
    } catch (err) { res.status(500).send("PDF Generation Failed"); }
});

app.listen(process.env.PORT || 3000, () => console.log("UFS Backend Live"));