require('dotenv').config();
const { createTimer } = require('../src/utils/simpleTimer');

class FakeMigrationGenerator {
    constructor() {
        // Sample real token addresses that have migrated (you can replace these)
        this.sampleTokens = [
            '89squDzuW1LdkfQjMq1CPKY7djXjfapfTThmqmbpump', // From your example
            'B4BQnaUKaoH6Bt8PoRJUmTohCBkzmeUJJUfKUMZgpump', // From your example
            '2J8uiyLBvqxnnujq4acUxxvJExx2rZZjdmdz92tvpump', // From your example
            'HBiqfjGvfVhXozbo2vG2gzsMKLUDZiZSJBYWWEtqx2rm', // JIMMY from your logs
            '5w15NHf6u6c7hWPS2vs5ioVdG8WvHaf8CdFwmWpdpump'  // Meme Mission from your logs
        ];

        // Known tokens with Twitter URLs (from your successful logs)
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

        // Sample Twitter URLs for testing
        this.sampleTwitterUrls = [
            'https://twitter.com/nypost/status/1927977755309723941',
            'https://x.com/cb_doge/status/1927968148667433003',
            'https://twitter.com/elonmusk/status/1927000000000000000',
            'https://x.com/pumpdotfun/status/1926000000000000000',
            'https://twitter.com/solana/status/1925000000000000000'
        ];
    }

    generateRandomSignature() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < 87; i++) { // Solana signatures are typically 87-88 chars
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    generateFakeMigrationMessage(tokenAddress = null) {
        const mint = tokenAddress || this.sampleTokens[Math.floor(Math.random() * this.sampleTokens.length)];
        const signature = this.generateRandomSignature();
        
        // Create the raw migration message as it comes from WebSocket
        const rawMessage = {
            signature: signature,
            mint: mint,
            txType: "migrate",
            pool: "pump-amm"
        };

        return rawMessage;
    }

    generateFakeMigrationEvent(tokenAddress = null) {
        const rawMessage = this.generateFakeMigrationMessage(tokenAddress);
        const operationId = `${rawMessage.mint.substring(0, 8)}_migration_${Date.now()}`;
        const timer = createTimer(operationId);
        
        // Transform to the format your MigrationMonitor expects
        const migrationEvent = {
            eventType: 'migration',
            mint: rawMessage.mint,
            signature: rawMessage.signature,
            pool: rawMessage.pool,
            timestamp: Date.now(),
            operationId: operationId,
            timer: timer,
            // Migration-specific data
            migrationData: {
                newPool: rawMessage.pool,
                migrationTimestamp: Date.now(),
                migrationTx: rawMessage.signature
            },
            // Include raw data
            rawData: rawMessage
        };

        return migrationEvent;
    }

    // Test with your actual MigrationMonitor using a real token
    async testWithMigrationMonitor(tokenAddress = null) {
        console.log('🧪 Testing Fake Migration with MigrationMonitor');
        console.log('='.repeat(50));

        try {
            // Import your MigrationMonitor
            const MigrationMonitor = require('../src/monitors/migrationMonitor');
            
            // Create monitor instance with test config
            const monitor = new MigrationMonitor({
                minTwitterLikes: 1, // Very low threshold for testing
                minTwitterViews: 1,
                enableViewCountExtraction: true,
                viewCountTimeout: 15000, // Give more time for view extraction
                maxConcurrentAnalyses: 1,
                telegram: {
                    // Add your telegram config here if you want to test publishing
                    botToken: process.env.TELEGRAM_BOT_TOKEN,
                    channels: [process.env.MIGRATION_TELEGRAM_CHANNEL_ID].filter(Boolean)
                }
            });

            // Listen for analysis completion
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

            // Use provided token or pick a known good one
            let tokenToTest = tokenAddress;
            if (!tokenToTest) {
                // Use JIMMY (known to have Twitter and be slow)
                const knownToken = this.tokensWithTwitter.find(t => t.symbol === 'JIMMY');
                tokenToTest = knownToken.address;
                console.log(`\n🎯 Using known token: ${knownToken.name} (${knownToken.symbol})`);
                console.log(`   • Address: ${knownToken.address}`);
                console.log(`   • Expected Twitter: ${knownToken.twitterUrl}`);
                console.log(`   • Previous timing: ${knownToken.expectedTime}`);
            } else {
                console.log(`\n🎯 Using provided token: ${tokenToTest}`);
            }

            // Generate and process a fake migration with real token
            console.log('\n🔄 Generating fake migration event...');
            const fakeEvent = this.generateFakeMigrationEvent(tokenToTest);
            
            console.log('\n📋 Fake migration event details:');
            console.log(`   • Mint: ${fakeEvent.mint}`);
            console.log(`   • Signature: ${fakeEvent.signature} (fake)`);
            console.log(`   • Operation ID: ${fakeEvent.operationId}`);

            console.log('\n🚀 Processing fake migration with REAL token analysis...');
            console.log('⏳ This will fetch real metadata from PumpFun API...');
            await monitor.processTokenMigration(fakeEvent);

            // Wait for complete analysis
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
            }, 120000); // Wait 2 minutes for complete analysis

        } catch (error) {
            console.error('❌ Error testing with MigrationMonitor:', error);
            process.exit(1);
        }
    }

    // Generate multiple fake messages
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

    // Generate events ready for processing
    generateEventBatch(count = 3, tokenAddresses = []) {
        console.log(`🔄 Generating ${count} fake migration events`);
        console.log('='.repeat(50));

        const events = [];
        
        for (let i = 0; i < count; i++) {
            const tokenAddress = tokenAddresses[i] || null;
            const event = this.generateFakeMigrationEvent(tokenAddress);
            
            events.push(event);
            
            console.log(`\n🔄 MIGRATION EVENT #${i + 1}:`);
            console.log('─'.repeat(50));
            console.log(`Mint: ${event.mint}`);
            console.log(`Signature: ${event.signature}`);
            console.log(`Operation ID: ${event.operationId}`);
            console.log(`Timer: ${event.timer.getElapsedMs()}ms elapsed`);
            console.log('─'.repeat(50));
        }

        return events;
    }

    // Interactive mode
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
        console.log('5. Generate with custom token address');
        console.log('6. Show known tokens with Twitter');
        console.log('7. Exit');

        const answer = await new Promise(resolve => {
            rl.question('\nChoose option (1-7): ', resolve);
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
                const customToken = await new Promise(resolve => {
                    rl.question('Enter token address: ', resolve);
                });
                console.log('\n📨 Migration Message with Custom Token:');
                console.log(JSON.stringify(this.generateFakeMigrationMessage(customToken), null, 2));
                break;

            case '6':
                console.log('\n🎯 Known Tokens with Twitter URLs:');
                this.tokensWithTwitter.forEach((token, i) => {
                    console.log(`\n${i + 1}. ${token.name} (${token.symbol})`);
                    console.log(`   Address: ${token.address}`);
                    console.log(`   Twitter: ${token.twitterUrl}`);
                    console.log(`   Previous timing: ${token.expectedTime}`);
                });
                break;

            case '7':
                console.log('👋 Goodbye!');
                rl.close();
                return;

            default:
                console.log('❌ Invalid option');
        }

        rl.close();
    }
}

// Command line usage
async function main() {
    const generator = new FakeMigrationGenerator();
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        // Interactive mode
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

        case 'events':
            const eventCount = parseInt(args[1]) || 3;
            const eventTokens = args.slice(2);
            generator.generateEventBatch(eventCount, eventTokens);
            break;

        case 'test':
            const customTokenArg = args[1];
            await generator.testWithMigrationMonitor(customTokenArg);
            break;

        default:
            console.log('🚀 Fake Migration Generator');
            console.log('='.repeat(30));
            console.log('Usage:');
            console.log('  node fakeMigrationGenerator.js                         - Interactive mode');
            console.log('  node fakeMigrationGenerator.js single [token]          - Generate single message');
            console.log('  node fakeMigrationGenerator.js batch [count]           - Generate batch');
            console.log('  node fakeMigrationGenerator.js events [count]          - Generate events');
            console.log('  node fakeMigrationGenerator.js test [token_address]    - Test with monitor');
            console.log('\nExamples:');
            console.log('  node fakeMigrationGenerator.js single HBiqfjGvfVhXozbo2vG2gzsMKLUDZiZSJBYWWEtqx2rm');
            console.log('  node fakeMigrationGenerator.js batch 5');
            console.log('  node fakeMigrationGenerator.js test                    - Auto-pick known token');
            console.log('  node fakeMigrationGenerator.js test HBiqfjGvfVhXozbo2vG2gzsMKLUDZiZSJBYWWEtqx2rm');
            console.log('\nKnown tokens with Twitter:');
            console.log('  HBiqfjGvfVhXozbo2vG2gzsMKLUDZiZSJBYWWEtqx2rm  (JIMMY - slow ~49s)');
            console.log('  5w15NHf6u6c7hWPS2vs5ioVdG8WvHaf8CdFwmWpdpump  (MEME - fast ~9s)');
    }
}

// Export for use as module
module.exports = FakeMigrationGenerator;

// Run if called directly
if (require.main === module) {
    main().catch(error => {
        console.error('❌ Script failed:', error);
        process.exit(1);
    });
}