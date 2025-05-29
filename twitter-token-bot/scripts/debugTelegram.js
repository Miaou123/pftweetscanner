// scripts/debugTelegram.js - Debug Telegram bot configuration and message sending
require('dotenv').config();

async function debugTelegramBot() {
    console.log('🔍 Telegram Bot Debug Script');
    console.log('='.repeat(50));
    
    // Check environment variables
    console.log('\n📋 Environment Variables:');
    console.log(`TELEGRAM_BOT_TOKEN: ${process.env.TELEGRAM_BOT_TOKEN ? 'SET (****)' : 'NOT SET'}`);
    console.log(`CREATION_TELEGRAM_CHANNEL_ID: ${process.env.CREATION_TELEGRAM_CHANNEL_ID || 'NOT SET'}`);
    console.log(`MIGRATION_TELEGRAM_CHANNEL_ID: ${process.env.MIGRATION_TELEGRAM_CHANNEL_ID || 'NOT SET'}`);
    
    if (!process.env.TELEGRAM_BOT_TOKEN) {
        console.log('❌ TELEGRAM_BOT_TOKEN is not set!');
        return;
    }
    
    try {
        const TelegramBot = require('node-telegram-bot-api');
        const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
        
        // Test 1: Check bot info
        console.log('\n🤖 Testing Bot Info:');
        try {
            const botInfo = await bot.getMe();
            console.log(`✅ Bot Name: ${botInfo.first_name}`);
            console.log(`✅ Bot Username: @${botInfo.username}`);
            console.log(`✅ Bot ID: ${botInfo.id}`);
            console.log(`✅ Bot is active: ${botInfo.is_bot ? 'Yes' : 'No'}`);
        } catch (error) {
            console.log(`❌ Failed to get bot info: ${error.message}`);
            return;
        }
        
        // Test 2: Check webhook status
        console.log('\n🔗 Checking Webhook Status:');
        try {
            const webhookInfo = await bot.getWebHookInfo();
            console.log(`Webhook URL: ${webhookInfo.url || 'None (using polling)'}`);
            console.log(`Pending updates: ${webhookInfo.pending_update_count || 0}`);
            if (webhookInfo.last_error_date) {
                console.log(`❌ Last webhook error: ${webhookInfo.last_error_message}`);
            } else {
                console.log(`✅ No webhook errors`);
            }
        } catch (error) {
            console.log(`⚠️ Could not check webhook: ${error.message}`);
        }
        
        // Test 3: Test channels
        const channels = [
            process.env.CREATION_TELEGRAM_CHANNEL_ID,
            process.env.MIGRATION_TELEGRAM_CHANNEL_ID,
            process.env.TELEGRAM_CHANNEL_ID,
            process.env.TELEGRAM_CHAT_ID
        ].filter(Boolean);
        
        if (channels.length === 0) {
            console.log('\n❌ No Telegram channels configured!');
            console.log('Please set CREATION_TELEGRAM_CHANNEL_ID or MIGRATION_TELEGRAM_CHANNEL_ID');
            return;
        }
        
        console.log(`\n📢 Testing ${channels.length} Channel(s):`);
        
        for (const channelId of channels) {
            console.log(`\n🎯 Testing channel: ${channelId}`);
            
            try {
                // Test message
                const testMessage = `🧪 <b>Debug Test Message</b>\n\n` +
                                  `🔄 MIGRATION | <b>TEST</b>\n` +
                                  `Test Token Name\n` +
                                  `<code>DDiP1d5aAjdKUCq1WrJGshk58TUFAkdmZ3zUXwAopump</code>\n\n` +
                                  `🐦 319 likes\n\n` +
                                  `<b>📦 Bundle Analysis:</b>\n` +
                                  `• ✅ No significant bundling detected\n\n` +
                                  `<b>👥 Top Holders Analysis:</b>\n` +
                                  `• 🐋 Whales: 1/20 (5.0%)\n` +
                                  `• 🆕 Fresh Wallets: 0/20 (0.0%)\n` +
                                  `• Top 10 Holdings: 45.2%\n\n` +
                                  `<b>🔗 Links:</b>\n` +
                                  `🐦 <a href="https://x.com/cobie/status/1928154469398892821">Tweet</a> | ` +
                                  `📈 <a href="https://dexscreener.com/solana/DDiP1d5aAjdKUCq1WrJGshk58TUFAkdmZ3zUXwAopump">DexScreener</a> | ` +
                                  `🔥 <a href="https://pump.fun/DDiP1d5aAjdKUCq1WrJGshk58TUFAkdmZ3zUXwAopump">Pump.fun</a> | ` +
                                  `📊 <a href="https://solscan.io/token/DDiP1d5aAjdKUCq1WrJGshk58TUFAkdmZ3zUXwAopump">Solscan</a>\n\n` +
                                  `<i>Test message sent at ${new Date().toLocaleString()}</i>`;
                
                const result = await bot.sendMessage(channelId, testMessage, {
                    parse_mode: 'HTML',
                    disable_web_page_preview: true
                });
                
                console.log(`✅ Message sent successfully!`);
                console.log(`   Message ID: ${result.message_id}`);
                console.log(`   Chat ID: ${result.chat.id}`);
                console.log(`   Chat Type: ${result.chat.type}`);
                if (result.chat.title) {
                    console.log(`   Chat Title: ${result.chat.title}`);
                }
                
            } catch (error) {
                console.log(`❌ Failed to send message to ${channelId}:`);
                console.log(`   Error: ${error.message}`);
                
                // Common error explanations
                if (error.message.includes('chat not found')) {
                    console.log(`   💡 The bot cannot find this chat. Make sure:`);
                    console.log(`      - The channel/chat exists`);
                    console.log(`      - The bot is added to the channel as an admin`);
                    console.log(`      - The channel ID is correct (should start with @ or -)`);
                } else if (error.message.includes('bot was blocked')) {
                    console.log(`   💡 The bot was blocked by the user`);
                } else if (error.message.includes('not enough rights')) {
                    console.log(`   💡 The bot doesn't have permission to send messages`);
                    console.log(`      - Make sure the bot is an admin in the channel`);
                } else if (error.message.includes('Too Many Requests')) {
                    console.log(`   💡 Rate limited. Wait a moment and try again`);
                }
            }
        }
        
        // Test 4: Show configuration used by your app
        console.log('\n⚙️ Your App Configuration:');
        try {
            const config = require('../src/config');
            console.log(`Bot Mode: ${config.botMode}`);
            console.log(`Creation Channels: ${JSON.stringify(config.telegram.creationChannels)}`);
            console.log(`Migration Channels: ${JSON.stringify(config.telegram.migrationChannels)}`);
            console.log(`Telegram Bot Token: ${config.telegram.botToken ? 'SET' : 'NOT SET'}`);
        } catch (error) {
            console.log(`Could not load app config: ${error.message}`);
        }
        
        // Test 5: Test your actual TelegramPublisher
        console.log('\n📤 Testing Your TelegramPublisher:');
        try {
            const TelegramPublisher = require('../src/publishers/telegramPublisher');
            
            const publisher = new TelegramPublisher({
                botToken: process.env.TELEGRAM_BOT_TOKEN,
                channels: channels
            });
            
            const status = publisher.getStatus();
            console.log(`✅ Publisher configured: ${status.configured}`);
            console.log(`✅ Publisher channels: ${status.channels}`);
            
            // Test with your publisher
            const testResult = await publisher.testConfiguration();
            if (testResult.success) {
                console.log(`✅ Publisher test successful!`);
            } else {
                console.log(`❌ Publisher test failed: ${testResult.error}`);
            }
            
        } catch (error) {
            console.log(`❌ Error testing TelegramPublisher: ${error.message}`);
        }
        
        console.log('\n🎉 Debug completed!');
        console.log('\n💡 If messages were sent successfully but you still don\'t receive them in your analysis:');
        console.log('   1. Check your bot is processing the right channels in config');
        console.log('   2. Verify the analysis actually calls the publisher');
        console.log('   3. Check for any errors in your analysis orchestrator');
        
    } catch (error) {
        console.log(`❌ Fatal error: ${error.message}`);
        console.log(error.stack);
    }
}

// Test specific message format that would be sent
function generateTestMessage() {
    const analysisResult = {
        tokenInfo: {
            symbol: 'CHIPCOIN',
            name: 'Chipcoin',
            address: 'DDiP1d5aAjdKUCq1WrJGshk58TUFAkdmZ3zUXwAopump',
            eventType: 'migration'
        },
        twitterMetrics: {
            likes: 319,
            views: 0,
            link: 'https://x.com/cobie/status/1928154469398892821'
        },
        analyses: {
            bundle: {
                success: true,
                result: {
                    bundleDetected: false,
                    percentageBundled: 0,
                    totalTokensBundled: 0,
                    bundles: []
                }
            },
            topHolders: {
                success: true,
                result: {
                    summary: {
                        totalHolders: 20,
                        whaleCount: 1,
                        freshWalletCount: 0,
                        whalePercentage: '5.0',
                        freshWalletPercentage: '0.0',
                        concentration: {
                            top10Percentage: '45.2'
                        }
                    }
                }
            }
        },
        operationId: 'DDiP1d5a_migration_test',
        timer: {
            getElapsedSeconds: () => '30.4'
        }
    };
    
    console.log('\n📝 This is the message format your bot would send:');
    console.log('='.repeat(60));
    
    try {
        const TelegramPublisher = require('../src/publishers/telegramPublisher');
        const publisher = new TelegramPublisher();
        const message = publisher.formatAnalysisMessage(analysisResult);
        console.log(message);
    } catch (error) {
        console.log(`Could not format message: ${error.message}`);
    }
    
    console.log('='.repeat(60));
}

// Main execution
async function main() {
    const args = process.argv.slice(2);
    
    if (args.includes('--message-format')) {
        generateTestMessage();
        return;
    }
    
    await debugTelegramBot();
    
    if (args.includes('--show-format')) {
        generateTestMessage();
    }
}

if (require.main === module) {
    main().catch(error => {
        console.error('Script failed:', error);
        process.exit(1);
    });
}

module.exports = { debugTelegramBot, generateTestMessage };