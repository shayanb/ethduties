const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');
const webpush = require('web-push');
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// Configure web push notifications
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
        process.env.VAPID_EMAIL || 'mailto:admin@ethduties.com',
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
    );
}

// Initialize Telegram bot if token is provided
let telegramBot = null;
if (process.env.TELEGRAM_BOT_TOKEN) {
    telegramBot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
    
    telegramBot.onText(/\/start/, (msg) => {
        const chatId = msg.chat.id;
        telegramBot.sendMessage(chatId, 
            'Welcome to ETH Duties Tracker! 🚀\n\n' +
            'Your chat ID is: `' + chatId + '`\n\n' +
            'Add this chat ID to the webapp to receive notifications about your validator duties.',
            { parse_mode: 'Markdown' }
        );
    });
}

// Store for push subscriptions (in production, use a database)
const pushSubscriptions = new Map();
const telegramSubscriptions = new Map();

// Beacon chain API proxy endpoints
app.post('/api/beacon/*', async (req, res) => {
    try {
        const beaconUrl = req.body.beaconUrl || 'http://localhost:5052';
        const apiPath = req.params[0];
        const fullUrl = `${beaconUrl}/${apiPath}`;
        
        const options = {
            method: req.body.method || 'GET',
            headers: {
                'Content-Type': 'application/json',
            }
        };
        
        if (req.body.data) {
            options.body = JSON.stringify(req.body.data);
        }
        
        const response = await fetch(fullUrl, options);
        const data = await response.json();
        
        res.json(data);
    } catch (error) {
        console.error('Proxy error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get sync committee duties
app.post('/api/sync-duties', async (req, res) => {
    try {
        const { beaconUrl, validators, epoch } = req.body;
        const validatorIndices = validators.filter(v => !v.startsWith('0x'));
        
        // Sync committee assignments are stable for 256 epochs
        const syncCommitteePeriod = Math.floor(epoch / 256);
        
        const response = await fetch(`${beaconUrl}/eth/v1/beacon/states/head/sync_committees`);
        const data = await response.json();
        
        if (!data.data) {
            return res.json({ data: [] });
        }
        
        // Check which validators are in the current sync committee
        const syncDuties = [];
        const currentCommittee = data.data.validators;
        const nextCommittee = data.data.next_validators || [];
        
        validators.forEach(validator => {
            const currentIndex = currentCommittee.indexOf(validator);
            const nextIndex = nextCommittee.indexOf(validator);
            
            if (currentIndex !== -1) {
                syncDuties.push({
                    validator,
                    period: 'current',
                    committee_index: currentIndex,
                    until_epoch: (syncCommitteePeriod + 1) * 256
                });
            }
            
            if (nextIndex !== -1) {
                syncDuties.push({
                    validator,
                    period: 'next',
                    committee_index: nextIndex,
                    from_epoch: (syncCommitteePeriod + 1) * 256
                });
            }
        });
        
        res.json({ data: syncDuties });
    } catch (error) {
        console.error('Sync duties error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Push notification subscription
app.post('/api/notifications/subscribe', (req, res) => {
    const { subscription, validators } = req.body;
    const key = subscription.endpoint;
    
    pushSubscriptions.set(key, {
        subscription,
        validators
    });
    
    res.json({ success: true });
});

// Telegram notification subscription
app.post('/api/telegram/subscribe', (req, res) => {
    const { chatId, validators } = req.body;
    
    if (!telegramBot) {
        return res.status(400).json({ error: 'Telegram bot not configured' });
    }
    
    telegramSubscriptions.set(chatId, validators);
    
    const validatorList = validators.map(v => {
        if (v.startsWith('0x')) {
            return `${v.slice(0, 10)}...${v.slice(-8)} (Pubkey)`;
        }
        return `#${v} (Index)`;
    }).join('\n• ');
    
    telegramBot.sendMessage(chatId, 
        `✅ Successfully subscribed to validator duty notifications!\n\n` +
        `Tracking ${validators.length} validator(s):\n• ${validatorList}`
    );
    
    res.json({ success: true });
});

// Send notification endpoint
app.post('/api/notify', async (req, res) => {
    const { type, validator, duty, urgency } = req.body;
    
    // Send push notifications
    for (const [key, data] of pushSubscriptions.entries()) {
        if (data.validators.includes(validator)) {
            const payload = JSON.stringify({
                title: `${type} Duty Alert`,
                body: `Validator ${validator.slice(0, 10)}... has ${type} duty in ${duty.timeUntil}`,
                icon: '/icon-192.png',
                badge: '/badge-72.png',
                data: { duty, urgency }
            });
            
            try {
                await webpush.sendNotification(data.subscription, payload);
            } catch (error) {
                console.error('Push notification error:', error);
                pushSubscriptions.delete(key);
            }
        }
    }
    
    // Send Telegram notifications
    if (telegramBot) {
        for (const [chatId, validators] of telegramSubscriptions.entries()) {
            if (validators.includes(validator)) {
                const urgencyEmoji = urgency === 'critical' ? '🚨' : urgency === 'urgent' ? '⚠️' : '📢';
                const message = `${urgencyEmoji} *${type} Duty Alert*\n\n` +
                    `Validator: \`${validator.slice(0, 10)}...\`\n` +
                    `Time until duty: ${duty.timeUntil}\n` +
                    `Slot: ${duty.slot}`;
                
                try {
                    await telegramBot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
                } catch (error) {
                    console.error('Telegram notification error:', error);
                }
            }
        }
    }
    
    res.json({ success: true });
});

// Get VAPID public key for push notifications
app.get('/api/vapid-public-key', (req, res) => {
    res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || '' });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    if (telegramBot) {
        console.log('Telegram bot is active');
    }
});