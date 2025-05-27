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
            return `${v.slice(0, 10)}...${v.slice(-8)}`;
        }
        return `[#${v}](https://beaconcha.in/validator/${v})`;
    }).join('\n• ');
    
    telegramBot.sendMessage(chatId, 
        `🎉 Welcome to ETH Duties Tracker! 🎉\n\n` +
        `✅ Successfully subscribed to validator duty notifications!\n\n` +
        `📊 Tracking ${validators.length} validator(s):\n• ${validatorList}\n\n` +
        `You'll receive notifications for:\n` +
        `💰 Block proposals\n` +
        `📝 Attestations\n` +
        `💎 Sync committee duties\n\n` +
        `✌️`,
        { 
            parse_mode: 'Markdown',
            disable_web_page_preview: true 
        }
    );
    
    res.json({ success: true });
});

// Update Telegram subscription (silent update when validators change)
app.post('/api/telegram/update', async (req, res) => {
    const { chatId, validators } = req.body;
    
    if (!telegramBot) {
        return res.status(400).json({ error: 'Telegram bot not configured' });
    }
    
    const oldValidators = telegramSubscriptions.get(chatId) || [];
    
    // Determine what changed BEFORE updating the subscription
    const added = validators.filter(v => !oldValidators.includes(v));
    const removed = oldValidators.filter(v => !validators.includes(v));
    
    // Now update the subscription
    telegramSubscriptions.set(chatId, validators);
    
    if (added.length === 0 && removed.length === 0) {
        return res.json({ success: true, message: 'No changes' });
    }
    
    let message = '📝 Subscription Updated\n\n';
    
    if (added.length > 0) {
        const addedList = await Promise.all(added.map(async v => {
            if (v.startsWith('0x')) {
                // Try to fetch validator index for pubkey
                try {
                    const beaconUrl = req.body.beaconUrl || 'http://localhost:5052';
                    const response = await fetch(`${beaconUrl}/eth/v1/beacon/states/head/validators/${v}`);
                    if (response.ok) {
                        const data = await response.json();
                        if (data.data && data.data.index) {
                            return `[#${data.data.index}](https://beaconcha.in/validator/${data.data.index}) (${v.slice(0, 10)}...${v.slice(-4)})`;
                        }
                    }
                } catch (error) {
                    console.error('Error fetching validator info:', error);
                }
                return `${v.slice(0, 10)}...${v.slice(-4)}`;
            }
            return `[#${v}](https://beaconcha.in/validator/${v})`;
        }));
        message += `➕ Added:\n• ${addedList.join('\n• ')}\n\n`;
    }
    
    if (removed.length > 0) {
        const removedList = removed.map(v => {
            if (v.startsWith('0x')) {
                return `${v.slice(0, 10)}...${v.slice(-8)}`;
            }
            return `#${v}`;
        }).join('\n• ');
        message += `➖ Removed:\n• ${removedList}\n\n`;
    }
    
    message += `Total validators tracked: ${validators.length}`;
    
    try {
        await telegramBot.sendMessage(chatId, message, { 
            parse_mode: 'Markdown',
            disable_web_page_preview: true 
        });
        res.json({ success: true });
    } catch (error) {
        console.error('Telegram update error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Notification settings update
app.post('/api/telegram/settings-update', async (req, res) => {
    const { chatId, settings } = req.body;
    
    if (!telegramBot) {
        return res.status(400).json({ error: 'Telegram bot not configured' });
    }
    
    try {
        let message = '⚙️ Notification Settings Updated\n\n';
        
        const duties = [];
        if (settings.notifyProposer) duties.push('💰 Block proposals');
        if (settings.notifyAttester) duties.push('📝 Attestations');
        if (settings.notifySync) duties.push('💎 Sync committee');
        
        if (duties.length > 0) {
            message += `Notifications enabled for:\n${duties.join('\n')}\n\n`;
            message += `⏰ Alert timing: ${settings.notifyMinutes} minutes before duty`;
        } else {
            message += '🔕 All notifications disabled';
        }
        
        await telegramBot.sendMessage(chatId, message, { 
            parse_mode: 'Markdown',
            disable_web_page_preview: true 
        });
        res.json({ success: true });
    } catch (error) {
        console.error('Settings update notification error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Send Telegram notification directly
app.post('/api/notify/telegram', async (req, res) => {
    const { chatId, message } = req.body;
    
    if (!telegramBot) {
        return res.status(400).json({ error: 'Telegram bot not configured' });
    }
    
    try {
        // Parse validator index from message and create clickable link
        let formattedMessage = message;
        const validatorMatch = message.match(/Validator #(\d+)/);
        if (validatorMatch) {
            const validatorIndex = validatorMatch[1];
            // Use Markdown format for clickable link
            formattedMessage = message.replace(
                `Validator #${validatorIndex}`,
                `Validator [#${validatorIndex}](https://beaconcha.in/validator/${validatorIndex})`
            );
        }
        
        await telegramBot.sendMessage(chatId, formattedMessage, { 
            parse_mode: 'Markdown',
            disable_web_page_preview: true 
        });
        res.json({ success: true });
    } catch (error) {
        console.error('Telegram notification error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Send notification endpoint
app.post('/api/notify', async (req, res) => {
    const { type, validator, validatorDisplay, duty, urgency } = req.body;
    
    console.log('Received notification request:', { type, validator, validatorDisplay });
    
    // Send push notifications
    let notificationsSent = 0;
    console.log(`Checking ${pushSubscriptions.size} push subscriptions`);
    
    for (const [key, data] of pushSubscriptions.entries()) {
        console.log('Checking subscription validators:', data.validators, 'against validator:', validator, 'type:', typeof validator);
        
        // Check if this subscription includes the validator (handle both string and number)
        const validatorStr = validator.toString();
        const validatorNum = parseInt(validator);
        const hasValidator = data.validators.some(v => 
            v === validator || 
            v === validatorStr || 
            v === validatorNum ||
            v.toString() === validatorStr
        );
        
        if (hasValidator) {
            console.log('Found matching subscription!');
            
            // Create notification with new format matching Telegram style
            let title, body;
            if (type === 'Proposer') {
                title = '🎉💰 BLOCK PROPOSAL! 🎉💰';
                body = `Validator ${validatorDisplay || validator} - ${duty.timeUntil}`;
            } else if (type === 'Attester') {
                title = '📝 Attestation Duty';
                body = `Validator ${validatorDisplay || validator} - ${duty.timeUntil}`;
            } else if (type === 'Sync Committee') {
                title = '🔐💎 SYNC COMMITTEE 💎🔐';
                body = `Validator ${validatorDisplay || validator} - Active now`;
            } else if (type === 'Block Confirmed' && duty.blockDetails) {
                title = '🎉💰 BLOCK CONFIRMED! 🎉💰';
                const details = duty.blockDetails;
                body = `${validatorDisplay || validator} - ${details.totalReward.toFixed(3)} ETH earned! (${details.txCount} txs)`;
            } else {
                title = `${type} Duty`;
                body = `Validator ${validatorDisplay || validator} - ${duty.timeUntil}`;
            }
            
            const payload = JSON.stringify({
                title,
                body,
                icon: '/icon-192.png',
                badge: '/badge-72.png',
                data: { duty, urgency }
            });
            
            try {
                await webpush.sendNotification(data.subscription, payload);
                notificationsSent++;
                console.log('Push notification sent successfully');
            } catch (error) {
                console.error('Push notification error:', error);
                pushSubscriptions.delete(key);
            }
        }
    }
    
    console.log(`Sent ${notificationsSent} push notifications`);
    
    // Note: Telegram notifications are now sent directly via /api/notify/telegram
    // to avoid duplicate notifications
    
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