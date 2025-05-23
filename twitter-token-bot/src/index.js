const TwitterBot = require('./bot/TwitterBot');
const logger = require('./utils/logger');
const config = require('./config');

async function main() {
    try {
        logger.info('🚀 Starting Twitter Token Bot...');
        
        // Validate configuration
        if (!config.twitter.apiKey || !config.solana.heliusRpcUrl) {
            throw new Error('Missing required configuration. Please check your .env file.');
        }
        
        // Initialize the bot
        const bot = new TwitterBot();
        await bot.initialize();
        
        // Start the bot
        await bot.start();
        
        logger.info('✅ Bot started successfully');
        
        // Handle graceful shutdown
        process.on('SIGINT', async () => {
            logger.info('🛑 Shutting down bot...');
            await bot.stop();
            process.exit(0);
        });
        
        process.on('SIGTERM', async () => {
            logger.info('🛑 Shutting down bot...');
            await bot.stop();
            process.exit(0);
        });
        
    } catch (error) {
        logger.error('❌ Failed to start bot:', error);
        process.exit(1);
    }
}

// Handle unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    process.exit(1);
});

main();
