// Enhanced test script to check WebSocket and metadata fetching
// Run with: node test-websocket.js

const WebSocket = require('ws');
const axios = require('axios');

const ws = new WebSocket('wss://pumpportal.fun/api/data');

// Function to fetch metadata from URI
async function fetchMetadata(uri) {
    try {
        console.log(`🔍 Fetching metadata from: ${uri}`);
        
        // Handle IPFS URLs
        let fetchUrl = uri;
        if (uri.startsWith('ipfs://')) {
            fetchUrl = uri.replace('ipfs://', 'https://ipfs.io/ipfs/');
        } else if (uri.includes('ipfs.io')) {
            fetchUrl = uri;
        } else if (uri.startsWith('ar://')) {
            fetchUrl = uri.replace('ar://', 'https://arweave.net/');
        }
        
        console.log(`📡 Actual fetch URL: ${fetchUrl}`);
        
        const response = await axios.get(fetchUrl, { 
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; TokenScanner/1.0)'
            }
        });
        
        if (response.data) {
            console.log('✅ METADATA FETCHED SUCCESSFULLY:');
            console.log('=== FULL METADATA ===');
            console.log(JSON.stringify(response.data, null, 2));
            console.log('====================');
            
            // Search for Twitter links in the metadata
            findTwitterInMetadata(response.data);
        } else {
            console.log('❌ No data in response');
        }
        
    } catch (error) {
        console.log(`❌ Failed to fetch metadata: ${error.message}`);
        if (error.response) {
            console.log(`   Status: ${error.response.status}`);
            console.log(`   Headers:`, error.response.headers);
        }
    }
}

// Function to search for Twitter links in metadata
function findTwitterInMetadata(metadata) {
    console.log('\n🔍 SEARCHING FOR TWITTER LINKS:');
    
    const twitterPatterns = [
        /https?:\/\/(www\.)?(twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/status\/\d+/gi,
        /https?:\/\/(www\.)?(twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/statuses\/\d+/gi,
        /https?:\/\/(www\.)?(twitter\.com|x\.com)\/[a-zA-Z0-9_]+/gi
    ];
    
    // Check specific fields first
    const fieldsToCheck = [
        'twitter',
        'social',
        'socials',
        'links',
        'external_url',
        'description',
        'attributes'
    ];
    
    console.log('📋 Checking specific fields:');
    fieldsToCheck.forEach(field => {
        if (metadata[field]) {
            console.log(`   ✅ Found field '${field}':`, metadata[field]);
            
            const fieldStr = JSON.stringify(metadata[field]);
            for (const pattern of twitterPatterns) {
                const matches = fieldStr.match(pattern);
                if (matches) {
                    console.log(`   🐦 TWITTER LINK FOUND in '${field}': ${matches[0]}`);
                }
            }
        } else {
            console.log(`   ❌ Field '${field}' not found`);
        }
    });
    
    // Search entire metadata as string
    console.log('\n🔍 Searching entire metadata as string:');
    const metadataStr = JSON.stringify(metadata);
    let foundAny = false;
    
    for (const pattern of twitterPatterns) {
        const matches = metadataStr.match(pattern);
        if (matches) {
            console.log(`   🐦 TWITTER LINKS FOUND: ${matches.join(', ')}`);
            foundAny = true;
        }
    }
    
    if (!foundAny) {
        console.log('   ❌ No Twitter links found in metadata');
    }
    
    console.log('======================\n');
}

ws.on('open', () => {
    console.log('✅ Connected to PumpPortal WebSocket');
    
    // Subscribe to new tokens
    const subscription = { method: 'subscribeNewToken' };
    ws.send(JSON.stringify(subscription));
    console.log('📡 Sent subscription request:', subscription);
    
    // Send ping every 30 seconds
    setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ method: 'ping' }));
            console.log('🏓 Sent ping');
        }
    }, 30000);
});

ws.on('message', async (data) => {
    try {
        const message = JSON.parse(data.toString());
        
        // Handle subscription confirmation
        if (message.message && message.message.includes('Successfully subscribed')) {
            console.log(`✅ ${message.message}\n`);
            return;
        }
        
        // Check if this is a token creation event
        if (message.txType === 'create' && message.mint && message.name && message.symbol) {
            console.log('\n🪙 NEW TOKEN DETECTED:');
            console.log(`   Name: ${message.name}`);
            console.log(`   Symbol: ${message.symbol}`);
            console.log(`   Mint: ${message.mint}`);
            console.log(`   Creator: ${message.traderPublicKey}`);
            console.log(`   URI: ${message.uri}`);
            console.log(`   Market Cap (SOL): ${message.marketCapSol}`);
            console.log(`   Initial Buy: ${message.initialBuy}`);
            
            // Fetch and display metadata
            if (message.uri) {
                console.log('\n📥 FETCHING METADATA...');
                await fetchMetadata(message.uri);
            } else {
                console.log('❌ No URI found for metadata');
            }
            
            console.log('\n' + '='.repeat(80) + '\n');
        } else {
            // Log other types of messages briefly
            const keys = Object.keys(message);
            console.log(`📥 Other message: ${keys.includes('signature') ? 'signature' : 'unknown'} (${keys.length} fields)`);
        }
        
    } catch (error) {
        console.error('❌ Error parsing message:', error);
        console.log('Raw data (first 1000 chars):', data.toString().substring(0, 1000));
    }
});

ws.on('error', (error) => {
    console.error('❌ WebSocket error:', error);
});

ws.on('close', (code, reason) => {
    console.log(`❌ WebSocket closed: ${code} - ${reason}`);
});

console.log('🔌 Connecting to PumpPortal WebSocket...');
console.log('⏳ Waiting for new token events (this may take a few minutes)...\n');