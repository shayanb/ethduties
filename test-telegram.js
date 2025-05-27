// Test script to verify Telegram notifications
const fetch = require('node-fetch');

async function testTelegramNotification() {
    try {
        // Test the direct Telegram notification endpoint
        const response = await fetch('http://localhost:3000/api/notify/telegram', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chatId: '123456789', // Replace with your actual chat ID
                message: '🚨 Validator #12345 has a Proposer duty in 5 minutes (slot 9876543)'
            })
        });
        
        const result = await response.json();
        console.log('Response:', result);
        
        if (!response.ok) {
            console.error('Error:', result.error);
        } else {
            console.log('Notification sent successfully!');
        }
    } catch (error) {
        console.error('Test failed:', error.message);
    }
}

testTelegramNotification();