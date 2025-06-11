// src/publishers/telegramPublisher.js - Complete Telegram publisher implementation
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
        const { tokenInfo, twitterMetrics, summary, operationId, timer } = analysisResult;
        
        // Determine event type emoji and title
        const eventType = tokenInfo.eventType || 'creation';
        const eventEmoji = eventType === 'migration' ? '🔄' : '🆕';
        const eventTitle = eventType === 'migration' ? 'MIGRATION DETECTED' : 'NEW TOKEN ALERT';
        
        // Header
        let message = `${eventEmoji} **${eventTitle}**\n\n`;
        
        // Token Info
        message += `🪙 **${escapeHtml(tokenInfo.name || 'Unknown')}** (${escapeHtml(tokenInfo.symbol || 'Unknown')})\n`;
        message += `📍 Address: \`${formatAddress(tokenInfo.address || tokenInfo.mint, 8, 8)}\`\n\n`;
        
        // Twitter Metrics
        if (twitterMetrics && (twitterMetrics.likes > 0 || twitterMetrics.views > 0)) {
            message += `📱 **Twitter Engagement:**\n`;
            if (twitterMetrics.likes > 0) {
                message += `❤️ Likes: ${formatNumber(twitterMetrics.likes)}\n`;
            }
            if (twitterMetrics.views > 0) {
                message += `👀 Views: ${formatNumber(twitterMetrics.views)}\n`;
            }
            if (twitterMetrics.link) {
                message += `🔗 [View Tweet](${twitterMetrics.link})\n`;
            }
            message += '\n';
        }
        
        // Analysis Results
        if (summary) {
            message += this.formatAnalysisResults(summary, analysisResult.analyses);
        } else {
            message += '⚠️ Analysis failed - Token too new for indexing\n\n';
        }
        
        // Processing Info
        if (timer) {
            message += `⏱️ Processed in ${timer.getElapsedSeconds()}s`;
        }
        if (operationId) {
            message += ` | ID: \`${operationId.substring(0, 8)}\``;
        }
        
        return message;
    }

    formatAnalysisResults(summary, analyses) {
        let message = '';
        
        // Risk Assessment
        if (summary.riskLevel && summary.overallScore !== undefined) {
            const riskEmoji = this.getRiskEmoji(summary.riskLevel);
            message += `🎯 **Risk Assessment:** ${riskEmoji} ${summary.riskLevel}`;
            if (summary.overallScore > 0) {
                message += ` (${summary.overallScore}/100)`;
            }
            message += '\n\n';
        }
        
        // Flags and Alerts
        if (summary.flags && summary.flags.length > 0) {
            message += `🚩 **Analysis Flags:**\n`;
            summary.flags.forEach(flag => {
                message += `${flag}\n`;
            });
            message += '\n';
        }
        
        // Bundle Analysis
        if (analyses?.bundle?.success && analyses.bundle.result) {
            const bundle = analyses.bundle.result;
            if (bundle.bundleDetected) {
                message += `📦 **Bundle Analysis:**\n`;
                message += `• Bundle detected: ${formatPercentage(bundle.percentageBundled)}% of supply\n`;
                if (bundle.totalHoldingAmountPercentage) {
                    message += `• Current holdings: ${formatPercentage(bundle.totalHoldingAmountPercentage)}%\n`;
                }
                message += `• Bundles found: ${bundle.bundles?.length || 0}\n\n`;
            }
        }
        
        // Top Holders Analysis
        if (analyses?.topHolders?.success && analyses.topHolders.result?.summary) {
            const holders = analyses.topHolders.result.summary;
            message += `👥 **Top Holders Analysis:**\n`;
            if (holders.whaleCount > 0) {
                message += `🐋 Whales: ${holders.whaleCount}/20\n`;
            }
            if (holders.freshWalletCount > 0) {
                message += `🆕 Fresh wallets: ${holders.freshWalletCount}/20\n`;
            }
            if (holders.concentration?.top5Percentage) {
                message += `📊 Top 5 concentration: ${holders.concentration.top5Percentage}%\n`;
            }
            message += '\n';
        }
        
        return message;
    }

    getRiskEmoji(riskLevel) {
        const riskEmojis = {
            'LOW': '🟢',
            'MEDIUM': '🟡',
            'HIGH': '🟠',
            'VERY_HIGH': '🔴',
            'UNKNOWN': '⚪'
        };
        return riskEmojis[riskLevel] || '⚪';
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