require('dotenv').config();
const WebSocket = require('ws');
const { createTimer } = require('../src/utils/simpleTimer');

class FakeMigrationGenerator {
    constructor() {
        // Sample real token addresses that have migrated
        this.sampleTokens = [
            '89squDzuW1LdkfQjMq1CPKY7djXjfapfTThmqmbpump',
            'B4BQnaUKaoH6Bt8PoRJUmTohCBkzmeUJJUfKUMZgpump',
            '2J8uiyLBvqxnnujq4acUxxvJExx2rZZjdmdz92tvpump',
            'HBiqfjGvfVhXozbo2vG2gzsMKLUDZiZSJBYWWEtqx2rm', // JIMMY
            '5w15NHf6u6c7hWPS2vs5ioVdG8WvHaf8CdFwmWpdpump'  // Meme Mission
        ];

        // Known tokens with Twitter URLs
        this.tokensWithTwitter = [
            {
                address: 'HBiqfjGvfVhXozbo2vG2gzsMKLUDZiZSJBYWWEtqx2rm',
                name: 'JIMMY THE PUNK DUCK',
                symbol: 'JIMMY',
                twitterUrl: 'https://twitter.com/nypost/status/1927977755309723941',
                expectedTime: '49.5s'
            },
            {
                address: '5w15NHf6u6c7hWPS2vs5ioVdG8WvHaf8CdFwmWpdpump',
                name: 'Meme Mission',
                symbol: 'MEME',
                twitterUrl: 'https://x.com/cb_doge/status/1927968148667433003',
                expectedTime: '9.2s'
            }
        ];

        // WebSocket configuration
        this.wsConfig = {
            url: 'wss://pumpportal.fun/api/data',
            reconnectAttempts: 0,
            maxReconnectAttempts: 3,
            reconnectDelay: 2000
        };

        this.ws = null;
        this.isConnected = false;
        this.messagesSent = 0;
        this.responses = [];
    }

    generateRandomSignature() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < 87; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    // Generate fake WebSocket migration message (as if from PumpPortal)
    generateFakeWebSocketMessage(tokenAddress = null, includeTokenInfo = true) {
        const mint = tokenAddress || this.sampleTokens[Math.floor(Math.random() * this.sampleTokens.length)];
        const signature = this.generateRandomSignature();
        
        if (includeTokenInfo && this.tokensWithTwitter.find(t => t.address === mint)) {
            // Use real token info for known tokens
            const tokenInfo = this.tokensWithTwitter.find(t => t.address === mint);
            return {
                signature: signature,
                mint: mint,
                name: tokenInfo.name,
                symbol: tokenInfo.symbol,
                uri: `https://ipfs.io/ipfs/fake-${mint}`,
                txType: "migration",
                pool: "raydium",
                timestamp: Date.now(),
                traderPublicKey: this.generateRandomAddress(),
                migrationData: {
                    liquidityAdded: Math.random() * 1000,
                    migrationTimestamp: Date.now(),
                    newPool: "raydium-pool-" + mint.substring(0, 8)
                }
            };
        } else {
            // Generate fake token info
            return {
                signature: signature,
                mint: mint,
                name: this.generateFakeTokenName(),
                symbol: this.generateFakeSymbol(),
                uri: `https://ipfs.io/ipfs/fake-${mint}`,
                txType: "migration",
                pool: "raydium",
                timestamp: Date.now(),
                traderPublicKey: this.generateRandomAddress(),
                migrationData: {
                    liquidityAdded: Math.random() * 1000,
                    migrationTimestamp: Date.now(),
                    newPool: "raydium-pool-" + mint.substring(0, 8)
                }
            };
        }
    }

    // Generate fake token creation message
    generateFakeCreationMessage(tokenAddress = null) {
        const mint = tokenAddress || this.generateRandomAddress();
        const signature = this.generateRandomSignature();
        
        return {
            signature: signature,
            mint: mint,
            name: this.generateFakeTokenName(),
            symbol: this.generateFakeSymbol(),
            uri: `https://ipfs.io/ipfs/fake-${mint}`,
            txType: "create",
            traderPublicKey: this.generateRandomAddress(),
            marketCapSol: Math.random() * 100 + 10,
            initialBuy: Math.random() > 0.5,
            solAmount: Math.random() * 10 + 1,
            bondingCurveKey: this.generateRandomAddress(),
            vTokensInBondingCurve: Math.floor(Math.random() * 1000000),
            vSolInBondingCurve: Math.random() * 100
        };
    }

    generateRandomAddress() {
        const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
        let result = '';
        for (let i = 0; i < 44; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    generateFakeTokenName() {
        const adjectives = ['Super', 'Mega', 'Ultra', 'Epic', 'Legendary', 'Cosmic', 'Digital', 'Quantum'];
        const nouns = ['Cat', 'Dog', 'Moon', 'Rocket', 'Diamond', 'Coin', 'Token', 'Meme'];
        const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
        const noun = nouns[Math.floor(Math.random() * nouns.length)];
        return `${adj} ${noun}`;
    }

    generateFakeSymbol() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        let result = '';
        for (let i = 0; i < (3 + Math.floor(Math.random() * 3)); i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    // Connect to WebSocket (simulating PumpPortal connection)
    async connectWebSocket() {
        return new Promise((resolve, reject) => {
            console.log(`🔌 Connecting to WebSocket: ${this.wsConfig.url}`);
            
            this.ws = new WebSocket(this.wsConfig.url);
            
            this.ws.on('open', () => {
                this.isConnected = true;
                console.log('✅ WebSocket connected successfully');
                
                // Subscribe to migration events
                const subscribeMessage = { method: 'subscribeMigration' };
                this.ws.send(JSON.stringify(subscribeMessage));
                console.log('📡 Subscribed to migration events');
                
                resolve();
            });
            
            this.ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    this.handleWebSocketMessage(message);
                } catch (error) {
                    console.log('📨 Raw message:', data.toString());
                }
            });
            
            this.ws.on('error', (error) => {
                console.error('❌ WebSocket error:', error);
                reject(error);
            });
            
            this.ws.on('close', (code, reason) => {
                this.isConnected = false;
                console.log(`🔌 WebSocket closed: ${code} - ${reason}`);
                
                if (this.wsConfig.reconnectAttempts < this.wsConfig.maxReconnectAttempts) {
                    this.wsConfig.reconnectAttempts++;
                    console.log(`🔄 Reconnecting... (${this.wsConfig.reconnectAttempts}/${this.wsConfig.maxReconnectAttempts})`);
                    setTimeout(() => {
                        this.connectWebSocket().catch(console.error);
                    }, this.wsConfig.reconnectDelay);
                }
            });
        });
    }

    handleWebSocketMessage(message) {
        console.log('📨 WebSocket message received:', message);
        this.responses.push({
            timestamp: Date.now(),
            message: message
        });
    }

    // Send fake migration through WebSocket (simulates PumpPortal sending data)
    async sendFakeMigrationViaWebSocket(tokenAddress = null, delay = 1000) {
        if (!this.isConnected) {
            throw new Error('WebSocket not connected');
        }
        
        console.log(`\n🚀 Sending fake migration via WebSocket...`);
        
        await new Promise(resolve => setTimeout(resolve, delay));
        
        const fakeMessage = this.generateFakeWebSocketMessage(tokenAddress);
        
        console.log('📤 Sending message:', JSON.stringify(fakeMessage, null, 2));
        
        this.ws.send(JSON.stringify(fakeMessage));
        this.messagesSent++;
        
        console.log(`✅ Message sent! (Total sent: ${this.messagesSent})`);
        
        return fakeMessage;
    }

    // Test WebSocket with your scanner bot
    async testWebSocketWithScanner(tokenAddress = null, messageCount = 1) {
        console.log('🧪 Testing WebSocket System');
        console.log('='.repeat(50));
        console.log('This will:');
        console.log('1. Connect to PumpPortal WebSocket');
        console.log('2. Send fake migration messages');
        console.log('3. Monitor if your scanner receives them');
        console.log('');
        
        try {
            // Connect to WebSocket
            await this.connectWebSocket();
            
            // Wait a bit for subscription to be processed
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            console.log(`\n📨 Sending ${messageCount} fake migration(s)...`);
            
            for (let i = 0; i < messageCount; i++) {
                const useToken = Array.isArray(tokenAddress) ? tokenAddress[i] : tokenAddress;
                const knownToken = useToken || this.tokensWithTwitter[i % this.tokensWithTwitter.length]?.address;
                
                console.log(`\n🔄 Sending message ${i + 1}/${messageCount}`);
                const message = await this.sendFakeMigrationViaWebSocket(knownToken, i * 2000);
                
                console.log(`📋 Message details:`);
                console.log(`   • Mint: ${message.mint}`);
                console.log(`   • Name: ${message.name}`);
                console.log(`   • Symbol: ${message.symbol}`);
                console.log(`   • Type: ${message.txType}`);
            }
            
            // Wait and show results
            console.log(`\n⏳ Waiting 30 seconds for your scanner to process...`);
            setTimeout(() => {
                this.showTestResults();
            }, 30000);
            
        } catch (error) {
            console.error('❌ WebSocket test failed:', error);
        }
    }

    // Test webhook integration (send alert to trading bot)
    async testWebhookIntegration(webhookUrl = 'http://localhost:3001/webhook/alert', apiKey = 'your-secret-key') {
        console.log('\n🔗 Testing Webhook Integration');
        console.log('='.repeat(40));
        
        const knownToken = this.tokensWithTwitter[0]; // Use JIMMY for testing
        
        // Create a fake alert like your scanner would send
        const alert = {
            timestamp: Date.now(),
            source: 'test-migration-generator',
            eventType: 'migration',
            token: {
                address: knownToken.address,
                symbol: knownToken.symbol,
                name: knownToken.name,
                eventType: 'migration'
            },
            twitter: {
                likes: Math.floor(Math.random() * 500) + 100, // 100-600 likes
                views: Math.floor(Math.random() * 500000) + 50000, // 50k-550k views
                url: knownToken.twitterUrl,
                publishedAt: new Date().toISOString()
            },
            analysis: {
                bundleDetected: Math.random() > 0.7, // 30% chance
                bundlePercentage: Math.random() * 50,
                whaleCount: Math.floor(Math.random() * 15),
                freshWalletCount: Math.floor(Math.random() * 15),
                riskLevel: ['LOW', 'MEDIUM', 'HIGH'][Math.floor(Math.random() * 3)]
            },
            confidence: ['MEDIUM', 'HIGH'][Math.floor(Math.random() * 2)]
        };
        
        console.log('📤 Sending alert to trading bot webhook...');
        console.log(`   • URL: ${webhookUrl}`);
        console.log(`   • Token: ${alert.token.symbol}`);
        console.log(`   • Likes: ${alert.twitter.likes}`);
        console.log(`   • Views: ${alert.twitter.views}`);
        console.log(`   • Risk Level: ${alert.analysis.riskLevel}`);
        
        try {
            const axios = require('axios');
            const startTime = Date.now();
            
            const response = await axios.post(webhookUrl, alert, {
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': apiKey,
                    'X-Source': 'migration-test',
                    'X-Version': '1.0'
                },
                timeout: 10000
            });
            
            const responseTime = Date.now() - startTime;
            
            console.log(`✅ Webhook response received in ${responseTime}ms`);
            console.log(`   • Status: ${response.status} ${response.statusText}`);
            console.log(`   • Response:`, response.data);
            
            return { success: true, responseTime, data: response.data };
            
        } catch (error) {
            console.error('❌ Webhook test failed:', {
                message: error.message,
                status: error.response?.status,
                data: error.response?.data
            });
            return { success: false, error: error.message };
        }
    }

    // Comprehensive end-to-end test
    async testEndToEnd(options = {}) {
        console.log('🔄 COMPREHENSIVE END-TO-END TEST');
        console.log('='.repeat(50));
        
        const config = {
            websocketTest: true,
            webhookTest: true,
            directMonitorTest: true,
            webhookUrl: 'http://localhost:3001/webhook/alert',
            apiKey: 'your-secret-key',
            messageCount: 2,
            ...options
        };
        
        const results = {
            websocket: null,
            webhook: null,
            directMonitor: null,
            startTime: Date.now()
        };
        
        // Test 1: WebSocket (if enabled)
        if (config.websocketTest) {
            console.log('\n🧪 TEST 1: WebSocket Communication');
            console.log('-'.repeat(30));
            try {
                await this.testWebSocketWithScanner(
                    this.tokensWithTwitter.map(t => t.address), 
                    config.messageCount
                );
                results.websocket = { success: true, messagesSent: this.messagesSent };
            } catch (error) {
                console.error('❌ WebSocket test failed:', error.message);
                results.websocket = { success: false, error: error.message };
            }
        }
        
        // Wait between tests
        if (config.websocketTest && (config.webhookTest || config.directMonitorTest)) {
            console.log('\n⏳ Waiting 10 seconds between tests...');
            await new Promise(resolve => setTimeout(resolve, 10000));
        }
        
        // Test 2: Webhook (if enabled)
        if (config.webhookTest) {
            console.log('\n🧪 TEST 2: Webhook Integration');
            console.log('-'.repeat(30));
            try {
                results.webhook = await this.testWebhookIntegration(config.webhookUrl, config.apiKey);
            } catch (error) {
                console.error('❌ Webhook test failed:', error.message);
                results.webhook = { success: false, error: error.message };
            }
        }
        
        // Test 3: Direct Monitor Test (if enabled)
        if (config.directMonitorTest) {
            console.log('\n🧪 TEST 3: Direct MigrationMonitor');
            console.log('-'.repeat(30));
            try {
                await this.testWithMigrationMonitor();
                results.directMonitor = { success: true };
            } catch (error) {
                console.error('❌ Direct monitor test failed:', error.message);
                results.directMonitor = { success: false, error: error.message };
            }
        }
        
        // Show final results
        setTimeout(() => {
            this.showComprehensiveResults(results);
        }, 5000);
        
        return results;
    }

    showTestResults() {
        console.log('\n📊 TEST RESULTS');
        console.log('='.repeat(40));
        console.log(`Messages sent: ${this.messagesSent}`);
        console.log(`Responses received: ${this.responses.length}`);
        console.log(`WebSocket connected: ${this.isConnected ? '✅' : '❌'}`);
        
        if (this.responses.length > 0) {
            console.log('\n📨 Recent responses:');
            this.responses.slice(-3).forEach((resp, i) => {
                console.log(`${i + 1}. ${JSON.stringify(resp.message).substring(0, 100)}...`);
            });
        }
        
        if (this.ws) {
            this.ws.close();
        }
    }

    showComprehensiveResults(results) {
        const totalTime = Date.now() - results.startTime;
        
        console.log('\n🏁 COMPREHENSIVE TEST RESULTS');
        console.log('='.repeat(50));
        console.log(`Total test time: ${(totalTime / 1000).toFixed(1)}s`);
        
        if (results.websocket) {
            console.log(`\n🔌 WebSocket Test: ${results.websocket.success ? '✅ PASSED' : '❌ FAILED'}`);
            if (results.websocket.success) {
                console.log(`   • Messages sent: ${results.websocket.messagesSent}`);
            } else {
                console.log(`   • Error: ${results.websocket.error}`);
            }
        }
        
        if (results.webhook) {
            console.log(`\n🔗 Webhook Test: ${results.webhook.success ? '✅ PASSED' : '❌ FAILED'}`);
            if (results.webhook.success) {
                console.log(`   • Response time: ${results.webhook.responseTime}ms`);
                console.log(`   • Qualified: ${results.webhook.data?.qualified || 'unknown'}`);
            } else {
                console.log(`   • Error: ${results.webhook.error}`);
            }
        }
        
        if (results.directMonitor) {
            console.log(`\n🔬 Direct Monitor Test: ${results.directMonitor.success ? '✅ PASSED' : '❌ FAILED'}`);
            if (!results.directMonitor.success) {
                console.log(`   • Error: ${results.directMonitor.error}`);
            }
        }
        
        // Overall status
        const passedTests = Object.values(results).filter(r => r && r.success).length;
        const totalTests = Object.values(results).filter(r => r !== null).length;
        
        console.log(`\n🎯 Overall Result: ${passedTests}/${totalTests} tests passed`);
        
        if (passedTests === totalTests) {
            console.log('🎉 ALL TESTS PASSED! Your system integration is working!');
        } else {
            console.log('⚠️ Some tests failed. Check the errors above.');
        }
        
        process.exit(0);
    }

    // Original methods (keeping for backward compatibility)
    generateFakeMigrationMessage(tokenAddress = null) {
        const mint = tokenAddress || this.sampleTokens[Math.floor(Math.random() * this.sampleTokens.length)];
        const signature = this.generateRandomSignature();
        
        return {
            signature: signature,
            mint: mint,
            txType: "migrate",
            pool: "pump-amm"
        };
    }

    generateFakeMigrationEvent(tokenAddress = null) {
        const rawMessage = this.generateFakeMigrationMessage(tokenAddress);
        const operationId = `${rawMessage.mint.substring(0, 8)}_migration_${Date.now()}`;
        const timer = createTimer(operationId);
        
        return {
            eventType: 'migration',
            mint: rawMessage.mint,
            signature: rawMessage.signature,
            pool: rawMessage.pool,
            timestamp: Date.now(),
            operationId: operationId,
            timer: timer,
            migrationData: {
                newPool: rawMessage.pool,
                migrationTimestamp: Date.now(),
                migrationTx: rawMessage.signature
            },
            rawData: rawMessage
        };
    }

    async testWithMigrationMonitor(tokenAddress = null) {
        console.log('🧪 Testing Fake Migration with MigrationMonitor');
        console.log('='.repeat(50));

        try {
            const MigrationMonitor = require('../src/monitors/migrationMonitor');
            
            const monitor = new MigrationMonitor({
                minTwitterLikes: 1,
                minTwitterViews: 1,
                enableViewCountExtraction: true,
                viewCountTimeout: 15000,
                maxConcurrentAnalyses: 1,
                telegram: {
                    botToken: process.env.TELEGRAM_BOT_TOKEN,
                    channels: [process.env.MIGRATION_TELEGRAM_CHANNEL_ID].filter(Boolean)
                }
            });

            monitor.on('analysisCompleted', (result) => {
                console.log('\n🎉 ANALYSIS COMPLETED!');
                console.log('='.repeat(50));
                
                if (result.timingBreakdown) {
                    console.log('📊 DETAILED TIMING BREAKDOWN:');
                    console.log(`   • Metadata fetch: ${result.timingBreakdown.metadataFetch}ms`);
                    console.log(`   • Twitter extract: ${result.timingBreakdown.twitterExtract}ms`);
                    console.log(`   • Queue wait: ${result.timingBreakdown.queueWait}ms`);
                    if (result.timingBreakdown.viewExtraction > 0) {
                        console.log(`   • View extraction: ${result.timingBreakdown.viewExtraction}ms (parallel)`);
                    }
                    console.log(`   • Analysis execution: ${result.timingBreakdown.analysis}ms (parallel)`);
                    if (result.timingBreakdown.bundleAnalysis > 0) {
                        console.log(`     ↳ Bundle analysis: ${result.timingBreakdown.bundleAnalysis}ms`);
                    }
                    if (result.timingBreakdown.topHoldersAnalysis > 0) {
                        console.log(`     ↳ Top holders analysis: ${result.timingBreakdown.topHoldersAnalysis}ms`);
                    }
                    console.log(`   • Total processing: ${result.timingBreakdown.totalProcessing}ms`);
                    console.log(`   • End-to-end: ${result.timingBreakdown.endToEnd}ms`);
                    if (result.timingBreakdown.timeSavedByParallelization > 0) {
                        console.log(`   • Time saved by parallelization: ~${result.timingBreakdown.timeSavedByParallelization}ms`);
                    }
                }
                
                console.log('\n🎯 RESULT SUMMARY:');
                console.log(`   • Token: ${result.tokenEvent.symbol} (${result.tokenEvent.name})`);
                console.log(`   • Success: ${result.analysisResult.success ? '✅' : '❌'}`);
                console.log(`   • Twitter Views: ${result.twitterMetrics?.views || 0}`);
                console.log(`   • Twitter Likes: ${result.twitterMetrics?.likes || 0}`);
                console.log(`   • Bundle Detected: ${result.analysisResult.analyses?.bundle?.result?.bundleDetected ? '🚨 YES' : '✅ NO'}`);
                console.log(`   • Top Holders Analyzed: ${result.analysisResult.analyses?.topHolders?.success ? '✅ YES' : '❌ NO'}`);
                
                if (result.analysisResult.analyses?.bundle?.result?.bundleDetected) {
                    const bundle = result.analysisResult.analyses.bundle.result;
                    console.log(`\n🚨 BUNDLE DETAILS:`);
                    console.log(`   • Bundles Found: ${bundle.bundles?.length || 0}`);
                    console.log(`   • Tokens Bundled: ${bundle.percentageBundled?.toFixed(2) || 0}%`);
                    console.log(`   • Currently Held: ${bundle.totalHoldingAmountPercentage?.toFixed(2) || 0}%`);
                }
            });

            let tokenToTest = tokenAddress;
            if (!tokenToTest) {
                const knownToken = this.tokensWithTwitter.find(t => t.symbol === 'JIMMY');
                tokenToTest = knownToken.address;
                console.log(`\n🎯 Using known token: ${knownToken.name} (${knownToken.symbol})`);
                console.log(`   • Address: ${knownToken.address}`);
                console.log(`   • Expected Twitter: ${knownToken.twitterUrl}`);
                console.log(`   • Previous timing: ${knownToken.expectedTime}`);
            } else {
                console.log(`\n🎯 Using provided token: ${tokenToTest}`);
            }

            console.log('\n🔄 Generating fake migration event...');
            const fakeEvent = this.generateFakeMigrationEvent(tokenToTest);
            
            console.log('\n📋 Fake migration event details:');
            console.log(`   • Mint: ${fakeEvent.mint}`);
            console.log(`   • Signature: ${fakeEvent.signature} (fake)`);
            console.log(`   • Operation ID: ${fakeEvent.operationId}`);

            console.log('\n🚀 Processing fake migration with REAL token analysis...');
            console.log('⏳ This will fetch real metadata from PumpFun API...');
            await monitor.processTokenMigration(fakeEvent);

            console.log('\n⏳ Waiting for complete analysis (up to 2 minutes)...');
            setTimeout(() => {
                console.log('\n📊 FINAL MONITOR STATUS:');
                console.log('='.repeat(40));
                console.log(monitor.getStatsString());
                
                const status = monitor.getStatus();
                if (status.timingAverages) {
                    console.log('\n⏱️ TIMING AVERAGES:');
                    console.log(`   • Metadata: ${status.timingAverages.metadata}`);
                    console.log(`   • Twitter: ${status.timingAverages.twitter}`);
                    console.log(`   • Views: ${status.timingAverages.views}`);
                    console.log(`   • Analysis: ${status.timingAverages.analysis}`);
                }
                
                if (status.timingExtremes && status.timingExtremes.slowest !== '0s ()') {
                    console.log('\n🏆 PERFORMANCE RECORDS:');
                    console.log(`   • Slowest: ${status.timingExtremes.slowest}`);
                    console.log(`   • Fastest: ${status.timingExtremes.fastest}`);
                }
                
                process.exit(0);
            }, 120000);

        } catch (error) {
            console.error('❌ Error testing with MigrationMonitor:', error);
            process.exit(1);
        }
    }

    // Interactive mode with new options
    async interactive() {
        const readline = require('readline');
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        console.log('🎮 Interactive Fake Migration Generator');
        console.log('='.repeat(40));
        console.log('Options:');
        console.log('1. Generate single message');
        console.log('2. Generate batch of messages');  
        console.log('3. Test with MigrationMonitor (auto-pick known token)');
        console.log('4. Test with MigrationMonitor (custom token)');
        console.log('5. 🔌 Test WebSocket communication');
        console.log('6. 🔗 Test Webhook integration');
        console.log('7. 🔄 Run comprehensive end-to-end test');
        console.log('8. Show known tokens with Twitter');
        console.log('9. Exit');

        const answer = await new Promise(resolve => {
            rl.question('\nChoose option (1-9): ', resolve);
        });

        switch (answer) {
            case '1':
                console.log('\n📨 Single Migration Message:');
                console.log(JSON.stringify(this.generateFakeMigrationMessage(), null, 2));
                break;

            case '2':
                const count = await new Promise(resolve => {
                    rl.question('How many messages? (default 3): ', (answer) => {
                        resolve(parseInt(answer) || 3);
                    });
                });
                this.generateBatch(count);
                break;

            case '3':
                console.log('\n🧪 Starting MigrationMonitor test with known token...');
                rl.close();
                await this.testWithMigrationMonitor();
                return;

            case '4':
                const customTokenForTest = await new Promise(resolve => {
                    rl.question('Enter token address to test: ', resolve);
                });
                console.log('\n🧪 Starting MigrationMonitor test with custom token...');
                rl.close();
                await this.testWithMigrationMonitor(customTokenForTest);
                return;

            case '5':
                const msgCount = await new Promise(resolve => {
                    rl.question('How many test messages? (default 2): ', (answer) => {
                        resolve(parseInt(answer) || 2);
                    });
                });
                console.log('\n🔌 Starting WebSocket test...');
                rl.close();
                await this.testWebSocketWithScanner(null, msgCount);
                return;

            case '6':
                const webhookUrl = await new Promise(resolve => {
                    rl.question('Webhook URL (default: http://localhost:3001/webhook/alert): ', (answer) => {
                        resolve(answer || 'http://localhost:3001/webhook/alert');
                    });
                });
                const apiKey = await new Promise(resolve => {
                    rl.question('API Key (default: your-secret-key): ', (answer) => {
                        resolve(answer || 'your-secret-key');
                    });
                });
                console.log('\n🔗 Starting Webhook test...');
                rl.close();
                await this.testWebhookIntegration(webhookUrl, apiKey);
                return;

            case '7':
                console.log('\n🔄 Starting comprehensive end-to-end test...');
                rl.close();
                await this.testEndToEnd();
                return;

            case '8':
                console.log('\n🎯 Known Tokens with Twitter URLs:');
                this.tokensWithTwitter.forEach((token, i) => {
                    console.log(`\n${i + 1}. ${token.name} (${token.symbol})`);
                    console.log(`   Address: ${token.address}`);
                    console.log(`   Twitter: ${token.twitterUrl}`);
                    console.log(`   Previous timing: ${token.expectedTime}`);
                });
                break;

            case '9':
                console.log('👋 Goodbye!');
                rl.close();
                return;

            default:
                console.log('❌ Invalid option');
        }

        rl.close();
    }

    generateBatch(count = 5, tokenAddresses = []) {
        console.log(`🔄 Generating ${count} fake migration messages`);
        console.log('='.repeat(50));

        const messages = [];
        
        for (let i = 0; i < count; i++) {
            const tokenAddress = tokenAddresses[i] || null;
            const message = this.generateFakeMigrationMessage(tokenAddress);
            
            messages.push(message);
            
            console.log(`\n📨 MIGRATION MESSAGE #${i + 1}:`);
            console.log('='.repeat(80));
            console.log(JSON.stringify(message, null, 2));
            console.log('='.repeat(80));
        }

        return messages;
    }
}

// Command line usage with new options
async function main() {
    const generator = new FakeMigrationGenerator();
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        await generator.interactive();
        return;
    }

    const command = args[0];
    
    switch (command) {
        case 'single':
            const tokenAddress = args[1] || null;
            console.log('📨 Single Migration Message:');
            console.log(JSON.stringify(generator.generateFakeMigrationMessage(tokenAddress), null, 2));
            break;

        case 'batch':
            const count = parseInt(args[1]) || 3;
            const tokens = args.slice(2);
            generator.generateBatch(count, tokens);
            break;

        case 'test':
            const customTokenArg = args[1];
            await generator.testWithMigrationMonitor(customTokenArg);
            break;

        case 'websocket':
            const msgCount = parseInt(args[1]) || 2;
            await generator.testWebSocketWithScanner(null, msgCount);
            break;

        case 'webhook':
            const webhookUrl = args[1] || 'http://localhost:3001/webhook/alert';
            const apiKey = args[2] || 'your-secret-key';
            await generator.testWebhookIntegration(webhookUrl, apiKey);
            break;

        case 'e2e':
        case 'end-to-end':
            await generator.testEndToEnd();
            break;

        default:
            console.log('🚀 Enhanced Fake Migration Generator');
            console.log('='.repeat(50));
            console.log('Usage:');
            console.log('  node fakeMigrationGenerator.js                         - Interactive mode');
            console.log('  node fakeMigrationGenerator.js single [token]          - Generate single message');
            console.log('  node fakeMigrationGenerator.js batch [count]           - Generate batch');
            console.log('  node fakeMigrationGenerator.js test [token_address]    - Test with monitor');
            console.log('  node fakeMigrationGenerator.js websocket [count]       - Test WebSocket (NEW!)');
            console.log('  node fakeMigrationGenerator.js webhook [url] [key]     - Test webhook (NEW!)');
            console.log('  node fakeMigrationGenerator.js e2e                     - End-to-end test (NEW!)');
            console.log('\nNew WebSocket & Integration Tests:');
            console.log('  websocket  - Connects to PumpPortal WS and sends fake migrations');
            console.log('  webhook    - Tests your trading bot webhook endpoint');
            console.log('  e2e        - Comprehensive test of all systems');
            console.log('\nExamples:');
            console.log('  node fakeMigrationGenerator.js websocket 3');
            console.log('  node fakeMigrationGenerator.js webhook http://localhost:3001/webhook/alert');
            console.log('  node fakeMigrationGenerator.js e2e');
    }
}

module.exports = FakeMigrationGenerator;

if (require.main === module) {
    main().catch(error => {
        console.error('❌ Script failed:', error);
        process.exit(1);
    });
}