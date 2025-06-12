// src/publishers/telegramPublisher.js - CLEAN UI FORMAT like your old design
const TelegramBot = require('node-telegram-bot-api');
const logger = require('../utils/logger');
const { formatNumber, formatPercentage, formatAddress, formatRiskLevel, escapeHtml } = require('../utils/formatters');

class TelegramPublisher {
    constructor(config = {}) {
        this.config = {
            botToken: config.botToken || process.env.TELEGRAM_BOT_TOKEN,
            channels: config.channels || [],
            timeout: config.timeout || 30000,
            retryAttempts: config.retryAttempts || 3,
            retryDelay: config.retryDelay || 2000,
            maxMessageLength: config.maxMessageLength || 4000,
            ...config
        };

        this.bot = null;
        this.isInitialized = false;
        this.stats = {
            messagesSent: 0,
            messagesSuccessful: 0,
            messagesFailed: 0,
            channelsConfigured: this.config.channels.length
        };

        this.initialize();
    }

    initialize() {
        try {
            if (!this.config.botToken) {
                logger.warn('No Telegram bot token provided - Telegram publishing disabled');
                return;
            }

            if (this.config.channels.length === 0) {
                logger.warn('No Telegram channels configured - Telegram publishing disabled');
                return;
            }

            this.bot = new TelegramBot(this.config.botToken, {
                polling: false,
                request: {
                    agentOptions: {
                        keepAlive: true,
                        family: 4
                    }
                }
            });

            this.isInitialized = true;
            logger.info(`📱 TelegramPublisher initialized with ${this.config.channels.length} channels`);

        } catch (error) {
            logger.error('Failed to initialize TelegramPublisher:', error);
            this.isInitialized = false;
        }
    }

    async publishAnalysis(analysisResult) {
        if (!this.isInitialized) {
            logger.warn('TelegramPublisher not initialized, skipping publish');
            return false;
        }

        try {
            const message = this.formatAnalysisMessage(analysisResult);
            return await this.sendToAllChannels(message);
        } catch (error) {
            logger.error('Error publishing analysis to Telegram:', error);
            this.stats.messagesFailed++;
            return false;
        }
    }

    formatAnalysisMessage(analysisResult) {
        const { tokenInfo, twitterMetrics, summary, operationId, timer, analyses } = analysisResult;
        
        // Event type
        const eventType = tokenInfo.eventType || 'creation';
        const eventEmoji = eventType === 'migration' ? '🔄' : '🆕';
        const eventTitle = eventType === 'migration' ? 'MIGRATION' : 'NEW TOKEN';
        
        // Build message in your clean format
        let message = `${eventEmoji} ${eventTitle} | ${escapeHtml(tokenInfo.symbol || 'Unknown')}\n`;
        message += `${escapeHtml(tokenInfo.name || 'Unknown Token')}\n`;
        // Make address clickable/copiable with monospace formatting
        message += `\`${tokenInfo.address || tokenInfo.mint || 'Unknown'}\`\n\n`;
        
        // Twitter metrics in compact format
        if (twitterMetrics && (twitterMetrics.likes > 0 || twitterMetrics.views > 0)) {
            const parts = [];
            if (twitterMetrics.views > 0) parts.push(`👀 ${formatNumber(twitterMetrics.views)} views`);
            if (twitterMetrics.likes > 0) parts.push(`❤️ ${formatNumber(twitterMetrics.likes)} likes`);
            
            // Add time ago if available
            if (twitterMetrics.publishedAt) {
                const timeAgo = this.getTimeAgo(twitterMetrics.publishedAt);
                if (timeAgo) parts.push(`📅 ${timeAgo}`);
            }
            
            if (parts.length > 0) {
                message += `🐦 ${parts.join(' • ')}\n\n`;
            }
        }
        
        // Bundle Analysis - Clean format
        if (analyses?.bundle?.success && analyses.bundle.result) {
            const bundle = analyses.bundle.result;
            if (bundle.bundleDetected) {
                message += `📦 Bundle Analysis:\n`;
                message += `• Bundles Found: ${bundle.bundles?.length || 0}\n`;
                
                // Format tokens bundled
                const tokensBundled = this.formatTokenAmount(bundle.totalTokensBundled);
                const bundledPercent = this.safeFormatPercentage(bundle.percentageBundled);
                message += `• Tokens Bundled: ${tokensBundled} (${bundledPercent}%)\n`;
                
                // Format currently held
                const tokensHeld = this.formatTokenAmount(bundle.totalHoldingAmount);
                const heldPercent = this.safeFormatPercentage(bundle.totalHoldingAmountPercentage);
                message += `• Currently Held: ${tokensHeld} (${heldPercent}%)\n\n`;
            }
        }
        
        // Top Holders Analysis - Clean format
        if (analyses?.topHolders?.success && analyses.topHolders.result?.summary) {
            const holders = analyses.topHolders.result.summary;
            message += `👥 Top Holders Analysis:\n`;
            
            // Whales
            const whaleCount = holders.whaleCount || 0;
            const whalePercent = this.safeParsePercentage(holders.whalePercentage);
            message += `• 🐋 Whales: ${whaleCount}/20 (${whalePercent}%)\n`;
            
            // Fresh wallets
            const freshCount = holders.freshWalletCount || 0;
            const freshPercent = this.safeParsePercentage(holders.freshWalletPercentage);
            message += `• 🆕 Fresh Wallets: ${freshCount}/20 (${freshPercent}%)\n`;
            
            // Top 10 concentration
            if (holders.concentration?.top10Percentage) {
                const top10Percent = this.safeParsePercentage(holders.concentration.top10Percentage);
                message += `• Top 10 Holdings: ${top10Percent}%\n\n`;
            }
        }
        
        // Links section
        message += `🔗 Links:\n`;
        const tokenAddress = tokenInfo.address || tokenInfo.mint;
        
        const links = [];
        if (twitterMetrics?.link) {
            links.push(`🐦 [Tweet](${twitterMetrics.link})`);
        }
        if (tokenAddress) {
            links.push(`📈 [DexScreener](https://dexscreener.com/solana/${tokenAddress})`);
            links.push(`🔥 [Pump.fun](https://pump.fun/${tokenAddress})`);
            links.push(`📊 [Solscan](https://solscan.io/token/${tokenAddress})`);
        }
        
        if (links.length > 0) {
            message += links.join(' | ') + '\n\n';
        }
        
        // Analysis info
        const duration = timer ? timer.getElapsedSeconds() : 'N/A';
        message += `Analysis time: ${duration}s | ID: ${operationId || 'N/A'}`;
        
        return message;
    }

    // Format token amounts with M/B suffixes
    formatTokenAmount(amount) {
        if (!amount || isNaN(amount)) return '0';
        
        const num = parseFloat(amount);
        if (num >= 1000000000) {
            return `${(num / 1000000000).toFixed(1)}B`;
        }
        if (num >= 1000000) {
            return `${(num / 1000000).toFixed(1)}M`;
        }
        if (num >= 1000) {
            return `${(num / 1000).toFixed(1)}K`;
        }
        return num.toFixed(0);
    }

    // Get time ago string
    getTimeAgo(publishedAt) {
        if (!publishedAt) return null;
        
        try {
            const now = new Date();
            const published = new Date(publishedAt);
            const diffMs = now - published;
            const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
            const diffMinutes = Math.floor(diffMs / (1000 * 60));
            
            if (diffHours >= 24) {
                const days = Math.floor(diffHours / 24);
                return `${days}d ago`;
            } else if (diffHours >= 1) {
                return `${diffHours}h ago`;
            } else if (diffMinutes >= 1) {
                return `${diffMinutes}m ago`;
            } else {
                return 'now';
            }
        } catch (error) {
            return null;
        }
    }

    // Safe percentage formatting that handles both strings and numbers
    safeFormatPercentage(value) {
        if (value === null || value === undefined) return '0.00';
        
        // If it's already a string, just return it
        if (typeof value === 'string') {
            return value;
        }
        
        // If it's a number, format it
        if (typeof value === 'number') {
            return value.toFixed(2);
        }
        
        // Fallback
        return '0.00';
    }

    // Safe percentage parsing that handles both strings and numbers
    safeParsePercentage(value) {
        if (value === null || value === undefined) return '0.0';
        
        // If it's already a string, just return it (remove % if present)
        if (typeof value === 'string') {
            return value.replace('%', '');
        }
        
        // If it's a number, format it
        if (typeof value === 'number') {
            return value.toFixed(1);
        }
        
        // Fallback
        return '0.0';
    }

    async sendToAllChannels(message) {
        if (!this.isInitialized || this.config.channels.length === 0) {
            return false;
        }

        const promises = this.config.channels.map(channel => 
            this.sendToChannel(channel, message)
        );

        try {
            const results = await Promise.allSettled(promises);
            const successful = results.filter(r => r.status === 'fulfilled').length;
            const failed = results.filter(r => r.status === 'rejected').length;

            this.stats.messagesSent++;
            this.stats.messagesSuccessful += successful;
            this.stats.messagesFailed += failed;

            if (successful > 0) {
                logger.info(`📤 Sent to ${successful}/${this.config.channels.length} Telegram channels`);
                return true;
            } else {
                logger.error(`❌ Failed to send to all ${this.config.channels.length} Telegram channels`);
                return false;
            }

        } catch (error) {
            logger.error('Error sending to Telegram channels:', error);
            this.stats.messagesFailed++;
            return false;
        }
    }

    async sendToChannel(channel, message, retryCount = 0) {
        try {
            // Ensure message isn't too long
            const finalMessage = this.truncateMessage(message);

            await this.bot.sendMessage(channel, finalMessage, {
                parse_mode: 'Markdown',
                disable_web_page_preview: true,
                disable_notification: false
            });

            logger.debug(`✅ Message sent to channel ${channel}`);
            return true;

        } catch (error) {
            logger.error(`❌ Failed to send to channel ${channel}:`, error.message);

            // Retry logic
            if (retryCount < this.config.retryAttempts) {
                logger.info(`🔄 Retrying send to ${channel} (${retryCount + 1}/${this.config.retryAttempts})`);
                await new Promise(resolve => setTimeout(resolve, this.config.retryDelay));
                return this.sendToChannel(channel, message, retryCount + 1);
            }

            throw error;
        }
    }

    truncateMessage(message) {
        if (message.length <= this.config.maxMessageLength) {
            return message;
        }

        const truncated = message.substring(0, this.config.maxMessageLength - 20);
        return truncated + '\n\n[Message truncated]';
    }

    async publishSimpleAlert(tokenInfo, alertMessage, priority = 'medium') {
        if (!this.isInitialized) {
            return false;
        }

        try {
            const priorityEmoji = priority === 'high' ? '🚨' : priority === 'medium' ? '⚠️' : 'ℹ️';
            const message = `${priorityEmoji} **ALERT**\n\n${alertMessage}`;
            
            return await this.sendToAllChannels(message);
        } catch (error) {
            logger.error('Error publishing simple alert:', error);
            return false;
        }
    }

    async testConnection() {
        if (!this.isInitialized) {
            return { success: false, error: 'Not initialized' };
        }

        try {
            const me = await this.bot.getMe();
            logger.info(`✅ Telegram bot connected: @${me.username}`);
            return { success: true, bot: me };
        } catch (error) {
            logger.error('❌ Telegram connection test failed:', error);
            return { success: false, error: error.message };
        }
    }

    getStatus() {
        return {
            isInitialized: this.isInitialized,
            channelsConfigured: this.config.channels.length,
            botTokenConfigured: !!this.config.botToken,
            stats: this.stats
        };
    }

    getStatsString() {
        const { messagesSent, messagesSuccessful, messagesFailed, channelsConfigured } = this.stats;
        const successRate = messagesSent > 0 ? ((messagesSuccessful / messagesSent) * 100).toFixed(1) : '0';
        
        return `📱 Telegram Stats: ${messagesSent} sent | ${messagesSuccessful} successful | ${messagesFailed} failed | ${channelsConfigured} channels | ${successRate}% success rate`;
    }

    resetStats() {
        this.stats = {
            messagesSent: 0,
            messagesSuccessful: 0,
            messagesFailed: 0,
            channelsConfigured: this.config.channels.length
        };
        logger.info('Telegram statistics reset');
    }

    async cleanup() {
        if (this.bot) {
            try {
                // Note: polling is disabled, so no need to stop polling
                this.bot = null;
                this.isInitialized = false;
                logger.info('📱 TelegramPublisher cleaned up');
            } catch (error) {
                logger.error('Error during TelegramPublisher cleanup:', error);
            }
        }
    }
}

module.exports = TelegramPublisher;