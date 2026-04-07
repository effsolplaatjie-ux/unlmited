require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const twilio = require('twilio');

const app = express();
app.use(cors());
app.use(express.json()); // Parse JSON bodies

// Initialize Twilio Client
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// Database Connection Pool (Compatible with TiDB and MySQL)
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// ==========================================
// UTILITY FUNCTIONS
// ==========================================

// Generate Unique Policy Number (Format: UFS-YYYYMMDD-XXXX)
const generatePolicyNumber = () => {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const random = Math.floor(1000 + Math.random() * 9000);
    return `UFS-${date}-${random}`;
};

// Send SMS Helper
const sendSMS = async (to, message) => {
    try {
        await twilioClient.messages.create({
            body: message,
            from: process.env.TWILIO_PHONE_NUMBER,
            to: to
        });
        console.log(`SMS sent to ${to}`);
    } catch (error) {
        console.error('Failed to send SMS:', error.message);
        // We don't throw here to prevent the main API calls from failing if the SMS API is down
    }
};

// ==========================================
// API ENDPOINTS
// ==========================================

// 1. Authentication: Login (Admin & Employees)
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const [rows] = await pool.query('SELECT * FROM users WHERE username = ? AND password = ?', [username, password]);
        if (rows.length > 0) {
            res.json({ success: true, user: { id: rows[0].id, username: rows[0].username, role: rows[0].role } });
        } else {
            res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. Add Employee/Staff (Admin only feature conceptually)
app.post('/api/employees', async (req, res) => {
    const { username, password } = req.body;
    try {
        const [result] = await pool.query('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', [username, password, 'employee']);
        res.status(201).json({ success: true, message: 'Employee added successfully', employeeId: result.insertId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3, 4 & 7. Create Policy / Online Form Submission (Auto-generates Number, Sends SMS)
app.post('/api/policies', async (req, res) => {
    const { client_name, client_phone, insurance_type } = req.body;
    const policy_number = generatePolicyNumber();

    try {
        const [result] = await pool.query(
            'INSERT INTO policies (policy_number, client_name, client_phone, insurance_type, status) VALUES (?, ?, ?, ?, ?)',
            [policy_number, client_name, client_phone, insurance_type, 'unpaid']
        );

        // Notify client that policy is opened/captured
        const message = `Welcome to Unlimited Funeral Services. Your policy (${insurance_type}) has been successfully captured. Policy Number: ${policy_number}.`;
        await sendSMS(client_phone, message);

        res.status(201).json({ 
            success: true, 
            message: 'Policy created successfully', 
            policy_number: policy_number 
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 5. Search & List Policies
app.get('/api/policies', async (req, res) => {
    const { search } = req.query;
    try {
        let query = 'SELECT * FROM policies ORDER BY created_at DESC';
        let params = [];

        if (search) {
            query = 'SELECT * FROM policies WHERE policy_number LIKE ? OR client_name LIKE ? ORDER BY created_at DESC';
            params = [`%${search}%`, `%${search}%`];
        }

        const [rows] = await pool.query(query, params);
        res.json({ success: true, data: rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 6 & 1. Toggle Policy Status (Paid/Unpaid) & Notify on Missed Payment
app.put('/api/policies/:id/status', async (req, res) => {
    const policyId = req.params.id;
    const { status } = req.body; // 'paid' or 'unpaid'

    if (!['paid', 'unpaid'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status. Must be paid or unpaid.' });
    }

    try {
        // Update the status
        await pool.query('UPDATE policies SET status = ? WHERE id = ?', [status, policyId]);

        // Fetch policy details to send SMS if necessary
        const [rows] = await pool.query('SELECT client_phone, client_name, policy_number FROM policies WHERE id = ?', [policyId]);
        
        if (rows.length > 0) {
            const policy = rows[0];

            // If status is toggled to unpaid, it triggers a missed payment notification
            if (status === 'unpaid') {
                const msg = `Dear ${policy.client_name}, this is a notice from Unlimited Funeral Services that your policy (${policy.policy_number}) currently reflects a missed payment. Please contact us to update your account.`;
                await sendSMS(policy.client_phone, msg);
            }
            
            res.json({ success: true, message: `Policy status updated to ${status}` });
        } else {
            res.status(404).json({ error: 'Policy not found' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// START SERVER
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Unlimited Funeral Services Backend running on port ${PORT}`);
});