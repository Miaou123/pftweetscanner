// scripts/debugAnalysisPublisher.js - Debug the actual analysis publishing flow
require('dotenv').config();

async function debugAnalysisPublisher() {
    console.log('🔍 Analysis Publisher Debug');
    console.log('='.repeat(50));
    
    try {
        // Test the exact same flow as your migration monitor
        const AnalysisOrchestrator = require('../src/orchestrators/analysisOrchestrator');
        const TelegramPublisher = require('../src/publishers/telegramPublisher');
        
        console.log('\n📋 Testing Analysis Orchestrator Configuration:');
        
        // Create orchestrator with migration config (same as your bot)
        const orchestrator = new AnalysisOrchestrator({
            botType: 'migration',
            publishResults: true,
            saveToJson: true,
            telegram: {
                botToken: process.env.TELEGRAM_BOT_TOKEN,
                channels: [process.env.MIGRATION_TELEGRAM_CHANNEL_ID].filter(Boolean)
            }
        });
        
        const orchestratorStatus = orchestrator.getStatus();
        console.log(`✅ Bot Type: ${orchestratorStatus.botType}`);
        console.log(`✅ Enabled Analyses: ${orchestratorStatus.enabledAnalyses.join(', ')}`);
        console.log(`✅ Publish Results: ${orchestratorStatus.config.publishResults}`);
        console.log(`✅ JSON Logging: ${orchestratorStatus.jsonLogging}`);
        
        console.log('\n📋 Testing Telegram Publisher Configuration:');
        
        // Test the publisher directly with same config as orchestrator
        const publisher = new TelegramPublisher({
            botToken: process.env.TELEGRAM_BOT_TOKEN,
            channels: [process.env.MIGRATION_TELEGRAM_CHANNEL_ID].filter(Boolean)
        });
        
        const publisherStatus = publisher.getStatus();
        console.log(`✅ Publisher Configured: ${publisherStatus.configured}`);
        console.log(`✅ Publisher Channels: ${publisherStatus.channels}`);
        console.log(`✅ Channels: ${JSON.stringify([process.env.MIGRATION_TELEGRAM_CHANNEL_ID].filter(Boolean))}`);
        
        console.log('\n🧪 Testing Exact Analysis Result Format:');
        
        // Create the EXACT same analysis result structure from your logs
        const mockAnalysisResult = {
            tokenAddress: 'DDiP1d5aAjdKUCq1WrJGshk58TUFAkdmZ3zUXwAopump',
            tokenInfo: {
                name: 'Chipcoin',
                symbol: 'CHIPCOIN',
                creator: 'test_creator',
                address: 'DDiP1d5aAjdKUCq1WrJGshk58TUFAkdmZ3zUXwAopump',
                eventType: 'migration'
            },
            twitterMetrics: {
                likes: 319,
                views: 0,
                link: 'https://x.com/cobie/status/1928154469398892821',
                publishedAt: null
            },
            operationId: 'DDiP1d5a_migration_1748543267125',
            startTime: Date.now() - 26728,
            success: true,
            analyses: {
                bundle: {
                    success: true,
                    type: 'bundle',
                    result: {
                        bundleDetected: false,
                        percentageBundled: 0,
                        totalTokensBundled: 0,
                        totalSolSpent: 0,
                        totalHoldingAmount: 0,
                        totalHoldingAmountPercentage: 0,
                        bundles: [],
                        totalTrades: 0,
                        tokenInfo: {},
                        migrated: false // This is key - your token was NOT marked as migrated
                    },
                    duration: 26725,
                    error: null
                },
                topHolders: {
                    success: true,
                    type: 'topHolders',
                    result: {
                        summary: {
                            totalHolders: 20,
                            whaleCount: 1,
                            freshWalletCount: 0,
                            whalePercentage: '5.0',
                            freshWalletPercentage: '0.0',
                            concentration: {
                                top5Percentage: '35.2',
                                top10Percentage: '45.2',
                                top20Percentage: '65.8'
                            },
                            riskScore: 85,
                            riskLevel: 'LOW'
                        }
                    },
                    duration: 3369,
                    error: null
                }
            },
            errors: [],
            summary: {
                totalAnalyses: 2,
                successfulAnalyses: 2,
                failedAnalyses: 0,
                flags: ['✅ No major red flags detected'],
                scores: {
                    bundle: 100,
                    topHolders: 85
                },
                alerts: [],
                analysisError: false,
                overallScore: 92,
                riskLevel: 'LOW'
            },
            endTime: Date.now(),
            duration: 26728,
            timer: {
                getElapsedSeconds: () => '30.4'
            }
        };
        
        console.log('\n📝 Generated Analysis Result Structure:');
        console.log(`   Success: ${mockAnalysisResult.success}`);
        console.log(`   Bundle Analysis: ${mockAnalysisResult.analyses.bundle.success ? '✅' : '❌'}`);
        console.log(`   Top Holders Analysis: ${mockAnalysisResult.analyses.topHolders.success ? '✅' : '❌'}`);
        console.log(`   Summary Error: ${mockAnalysisResult.summary.analysisError}`);
        
        console.log('\n📤 Testing Publisher with Mock Analysis:');
        
        try {
            await publisher.publishAnalysis(mockAnalysisResult);
            console.log('✅ Mock analysis published successfully!');
        } catch (error) {
            console.log(`❌ Failed to publish mock analysis: ${error.message}`);
            console.log(error.stack);
        }
        
        console.log('\n🔍 Testing Message Formatting:');
        
        try {
            const formattedMessage = publisher.formatAnalysisMessage(mockAnalysisResult);
            console.log('✅ Message formatted successfully');
            console.log('\n📝 Formatted Message Preview:');
            console.log('─'.repeat(60));
            console.log(formattedMessage.substring(0, 500) + '...');
            console.log('─'.repeat(60));
            console.log(`Total message length: ${formattedMessage.length} characters`);
        } catch (error) {
            console.log(`❌ Failed to format message: ${error.message}`);
        }
        
        console.log('\n🔍 Debugging Analysis Orchestrator Publisher:');
        
        // Check if the orchestrator has the publisher correctly configured
        try {
            const testTokenData = {
                tokenAddress: 'DDiP1d5aAjdKUCq1WrJGshk58TUFAkdmZ3zUXwAopump',
                tokenInfo: mockAnalysisResult.tokenInfo,
                twitterMetrics: mockAnalysisResult.twitterMetrics,
                operationId: 'test_debug_' + Date.now(),
                timer: {
                    getElapsedSeconds: () => '1.0'
                }
            };
            
            console.log('🧪 Running actual orchestrator analysis (this might take time)...');
            console.log('⚠️  This will run real bundle and top holders analysis!');
            
            // Ask user if they want to run the full analysis
            const readline = require('readline');
            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout
            });
            
            const runFullTest = await new Promise(resolve => {
                rl.question('Do you want to run the full analysis test? (y/N): ', resolve);
            });
            
            rl.close();
            
            if (runFullTest.toLowerCase() === 'y' || runFullTest.toLowerCase() === 'yes') {
                console.log('🚀 Running full analysis test...');
                const fullAnalysisResult = await orchestrator.analyzeToken(testTokenData);
                
                console.log('\n📊 Full Analysis Results:');
                console.log(`   Success: ${fullAnalysisResult.success}`);
                console.log(`   Duration: ${fullAnalysisResult.duration}ms`);
                console.log(`   Analyses: ${Object.keys(fullAnalysisResult.analyses).join(', ')}`);
                
                if (fullAnalysisResult.summary) {
                    console.log(`   Summary Error: ${fullAnalysisResult.summary.analysisError}`);
                    console.log(`   Risk Level: ${fullAnalysisResult.summary.riskLevel}`);
                }
                
                console.log('\n📤 The analysis should have been automatically published to Telegram');
                console.log('   Check your @PFMigWatcher channel for the message');
            } else {
                console.log('⏭️  Skipping full analysis test');
            }
            
        } catch (error) {
            console.log(`❌ Error testing orchestrator: ${error.message}`);
        }
        
        console.log('\n💡 Debugging Summary:');
        console.log('='.repeat(50));
        console.log('If the mock analysis was published but your real analysis wasn\'t:');
        console.log('1. Check if your analysis orchestrator is calling publishAnalysis()');
        console.log('2. Verify the analysis result structure matches expected format');
        console.log('3. Look for any errors in the orchestrator\'s publishResults method');
        console.log('4. Check if config.publishResults is true in your orchestrator');
        
        console.log('\nBased on your logs, the analysis completed successfully:');
        console.log('- ✅ Bundle analysis: 26725ms (no bundles found)');
        console.log('- ✅ Top holders analysis: 3369ms');
        console.log('- ✅ "Published analysis to 1/1 channels"');
        console.log('\nThe issue might be:');
        console.log('- Message formatting error causing silent failure');
        console.log('- Channel permissions changed between test and real message');
        console.log('- Error in the specific message content (HTML parsing)');
        
    } catch (error) {
        console.log(`❌ Fatal error: ${error.message}`);
        console.log(error.stack);
    }
}

// Main execution
if (require.main === module) {
    debugAnalysisPublisher().catch(error => {
        console.error('Script failed:', error);
        process.exit(1);
    });
}

module.exports = { debugAnalysisPublisher };