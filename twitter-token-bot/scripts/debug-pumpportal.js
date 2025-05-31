// debug-pumpportal.js - Deep debug of PumpPortal WebSocket
const WebSocket = require('ws');

console.log('🔍 Starting PumpPortal WebSocket Debug...');

const ws = new WebSocket('wss://pumpportal.fun/api/data');

let messageCount = 0;
let subscriptionsSent = false;

ws.on('open', function open() {
    console.log('✅ Connected to PumpPortal WebSocket');
    
    // Wait a bit before subscribing
    setTimeout(() => {
        console.log('\n📤 Sending subscription requests...');
        
        // Test new token subscription first (we know this works)
        const tokenPayload = { method: "subscribeNewToken" };
        ws.send(JSON.stringify(tokenPayload));
        console.log('✅ Sent new token subscription:', JSON.stringify(tokenPayload));
        
        // Then test migration subscription
        setTimeout(() => {
            const migrationPayload = { method: "subscribeMigration" };
            ws.send(JSON.stringify(migrationPayload));
            console.log('✅ Sent migration subscription:', JSON.stringify(migrationPayload));
            subscriptionsSent = true;
        }, 1000);
    }, 1000);
});

ws.on('message', function message(data) {
    messageCount++;
    const timestamp = new Date().toISOString();
    
    try {
        const message = JSON.parse(data.toString());
        
        console.log(`\n[${messageCount}] ${timestamp}`);
        
        // Check for subscription confirmations
        if (message.message) {
            if (message.message.includes('Successfully subscribed')) {
                console.log('🎉 SUBSCRIPTION CONFIRMED:', message.message);
            } else {
                console.log('📢 SERVER MESSAGE:', message.message);
            }
        }
        // Check for different transaction types
        else if (message.txType) {
            console.log(`🔔 TRANSACTION: ${message.txType}`);
            
            if (message.txType === 'migration') {
                console.log('🔥 MIGRATION DETECTED!');
                console.log('   Mint:', message.mint);
                console.log('   Signature:', message.signature);
                console.log('   All keys:', Object.keys(message).join(', '));
            } else if (message.txType === 'create') {
                console.log('🆕 TOKEN CREATION:');
                console.log('   Name:', message.name);
                console.log('   Symbol:', message.symbol);
                console.log('   Mint:', message.mint);
            } else {
                console.log('❓ UNKNOWN TX TYPE:', message.txType);
                console.log('   Keys:', Object.keys(message).join(', '));
                
                // Check if this might be a migration with different structure
                if (message.mint && (message.signature || message.sig)) {
                    console.log('⚠️  POTENTIAL MIGRATION WITH DIFFERENT STRUCTURE:');
                    console.log('   Full message:', JSON.stringify(message, null, 2));
                }
            }
        }
        // Unknown message structure
        else {
            console.log('❓ UNKNOWN MESSAGE STRUCTURE:');
            console.log('   Keys:', Object.keys(message).join(', '));
            console.log('   Sample:', JSON.stringify(message, null, 2).substring(0, 200) + '...');
        }
        
    } catch (error) {
        console.error('❌ Parse error:', error.message);
        console.log('Raw data (first 200 chars):', data.toString().substring(0, 200));
    }
});

ws.on('error', (error) => {
    console.error('❌ WebSocket error:', error);
});

ws.on('close', (code, reason) => {
    console.log(`\n❌ Connection closed: ${code} - ${reason}`);
    console.log(`📊 Total messages received: ${messageCount}`);
});

// Status check every 30 seconds
const statusInterval = setInterval(() => {
    if (subscriptionsSent) {
        console.log(`\n⏰ Status check - Messages received: ${messageCount}`);
        console.log('Connection state:', ws.readyState === WebSocket.OPEN ? 'OPEN' : 'CLOSED');
    }
}, 30000);

// Run for 10 minutes to catch migrations
setTimeout(() => {
    console.log('\n⏰ Test completed after 10 minutes');
    clearInterval(statusInterval);
    ws.close();
}, 10 * 60 * 1000);

console.log('🕐 Running for 10 minutes to monitor for migrations...');