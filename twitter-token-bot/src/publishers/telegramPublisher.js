// src/publishers/telegramPublisher.js - Updated with Top Holders Analysis
const logger = require('../utils/logger');
const { formatNumber } = require('../utils/formatters');

class TelegramPublisher {
    constructor(config = {}) {
        this.config = {
            botToken: config.botToken || process.env.TELEGRAM_BOT_TOKEN,
            channels: config.channels || [
                process.env.TELEGRAM_CHANNEL_ID || process.env.TELEGRAM_CHAT_ID
            ].filter(Boolean),
            maxMessageLength: config.maxMessageLength || 4096,
            enablePreviews: config.enablePreviews !== false,
            retryAttempts: config.retryAttempts || 3,
            retryDelay: config.retryDelay || 5000,
            ...config
        };

        // Initialize Telegram client
        if (this.config.botToken) {
            this.TelegramBot = require('node-telegram-bot-api');
            this.bot = new this.TelegramBot(this.config.botToken);
        } else {
            logger.warn('No Telegram bot token provided - publishing disabled');
        }
    }

    async publishAnalysis(analysisResult) {
        if (!this.bot || !this.config.channels.length) {
            logger.warn('Telegram publishing not configured');
            return;
        }

        try {
            const message = this.formatAnalysisMessage(analysisResult);
            
            // Send to all configured channels
            const promises = this.config.channels.map(channelId => 
                this.sendMessage(channelId, message)
            );

            const results = await Promise.allSettled(promises);
            const successful = results.filter(r => r.status === 'fulfilled').length;
            
            // Log final timing
            if (analysisResult.timer) {
                logger.info(`⏱️ [${analysisResult.operationId}] Total pipeline time: ${analysisResult.timer.getElapsedSeconds()}s`);
            }
            
            logger.info(`📤 Published analysis to ${successful}/${this.config.channels.length} channels`);

        } catch (error) {
            logger.error('Error publishing analysis to Telegram:', error);
        }
    }

    formatAnalysisMessage(analysisResult) {
        const { tokenInfo, twitterMetrics, analyses, operationId, summary } = analysisResult;
        
        // Header with token info and overall risk
        let message = this.formatHeader(tokenInfo, twitterMetrics, summary);
        
        // Bundle analysis results
        if (analyses.bundle && analyses.bundle.success) {
            message += this.formatBundleAnalysis(analyses.bundle.result);
        }
        
        // Top Holders analysis results
        if (analyses.topHolders && analyses.topHolders.success) {
            message += this.formatTopHoldersAnalysis(analyses.topHolders.result);
        }

        // Overall summary flags
        if (summary && summary.flags && summary.flags.length > 0) {
            message += this.formatSummaryFlags(summary.flags);
        }
        
        // Links and footer
        message += this.formatFooter(tokenInfo.address || tokenInfo.mint, operationId, twitterMetrics.link, analysisResult.timer);
        
        // Truncate if too long
        if (message.length > this.config.maxMessageLength) {
            message = this.truncateMessage(message);
        }
        
        return message;
    }

    formatHeader(tokenInfo, twitterMetrics, summary) {
        const symbol = tokenInfo.symbol || 'Unknown';
        const name = tokenInfo.name || 'Unknown Token';
        const eventType = tokenInfo.eventType === 'migration' ? '🔄 MIGRATION' : '🆕 NEW TOKEN';
        
        // Add risk level indicator
        const riskEmoji = this.getRiskEmoji(summary?.riskLevel || 'UNKNOWN');
        const riskLevel = summary?.riskLevel || 'UNKNOWN';
        
        let header = `${eventType} | ${riskEmoji} ${riskLevel} | <b>${symbol}</b>\n`;
        header += `${name}\n`;
        
        if (twitterMetrics) {
            const likesText = twitterMetrics.likes > 0 ? `${formatNumber(twitterMetrics.likes)} likes` : '';
            const retweetsText = twitterMetrics.retweets > 0 ? `${formatNumber(twitterMetrics.retweets)} RT` : '';
            
            if (likesText || retweetsText) {
                const parts = [likesText, retweetsText].filter(Boolean);
                header += `🐦 Twitter: ${parts.join(' | ')}`;
                
                // Include publishing date
                if (twitterMetrics.publishedAt) {
                    const timeAgo = this.formatTimeAgo(twitterMetrics.publishedAt);
                    header += ` • ${timeAgo}`;
                }
                header += '\n';
            }
        }
        
        return header + '\n';
    }

    formatBundleAnalysis(result) {
        if (!result) return '';
        
        let section = '<b>📦 Bundle Analysis:</b>\n';
        
        if (result.bundleDetected) {
            const totalBoughtPercentage = result.percentageBundled || 0;
            const currentlyHeldPercentage = result.totalHoldingAmountPercentage || 0;
            
            section += `• Bundles Found: ${result.bundles.length}\n`;
            section += `• Tokens Bundled: ${this.formatLargeNumber(result.totalTokensBundled)} (${totalBoughtPercentage.toFixed(2)}%)\n`;
            section += `• Currently Held: ${this.formatLargeNumber(result.totalHoldingAmount)} (${currentlyHeldPercentage.toFixed(2)}%)\n`;
            
        } else {
            section += '✅ No significant bundling detected\n';
        }
        
        return section + '\n';
    }

    formatTopHoldersAnalysis(result) {
        if (!result || !result.summary) return '';
        
        const summary = result.summary;
        let section = '<b>👥 Top 20 Holders Analysis:</b>\n';
        
        // Wallet type breakdown (only whales, fresh, and regular)
        section += `• 🐋 Whales: ${summary.whaleCount}/20 (${summary.whalePercentage}%)\n`;
        section += `• 🆕 Fresh Wallets: ${summary.freshWalletCount}/20 (${summary.freshWalletPercentage}%)\n`;
        section += `• 👤 Regular: ${summary.regularWalletCount}/20\n`;
        
        // Concentration metrics
        section += `• Top 5 Holdings: ${summary.concentration.top5Percentage}%\n`;
        section += `• Top 10 Holdings: ${summary.concentration.top10Percentage}%\n`;
        
        // Risk assessment
        const riskEmoji = this.getRiskEmoji(summary.riskLevel);
        section += `• Risk Level: ${riskEmoji} ${summary.riskLevel} (Score: ${summary.riskScore}/100)\n`;
        
        return section + '\n';
    }

    formatSummaryFlags(flags) {
        if (!flags || flags.length === 0) return '';
        
        let section = '<b>🚩 Analysis Summary:</b>\n';
        
        // Group flags by type for better organization
        const criticalFlags = flags.filter(flag => flag.includes('🔴'));
        const warningFlags = flags.filter(flag => flag.includes('🟡'));
        const successFlags = flags.filter(flag => flag.includes('✅'));
        
        // Show critical flags first
        if (criticalFlags.length > 0) {
            criticalFlags.forEach(flag => {
                section += `${flag}\n`;
            });
        }
        
        // Then warning flags
        if (warningFlags.length > 0) {
            warningFlags.forEach(flag => {
                section += `${flag}\n`;
            });
        }
        
        // Finally success flags
        if (successFlags.length > 0 && criticalFlags.length === 0 && warningFlags.length === 0) {
            successFlags.forEach(flag => {
                section += `${flag}\n`;
            });
        }
        
        return section + '\n';
    }

    formatLargeNumber(num) {
        if (!num || isNaN(num)) return '0';
        
        if (num >= 1000000000) {
            return (num / 1000000000).toFixed(1) + 'B';
        }
        if (num >= 1000000) {
            return (num / 1000000).toFixed(1) + 'M';
        }
        if (num >= 1000) {
            return (num / 1000).toFixed(1) + 'K';
        }
        
        return Math.round(num).toString();
    }

    formatFooter(tokenAddress, operationId, twitterLink, timer = null) {
        let footer = '<b>🔗 Links:</b>\n';
        footer += `🐦 <a href="${twitterLink}">Tweet</a> | `;
        footer += `📈 <a href="https://dexscreener.com/solana/${tokenAddress}">DexScreener</a> | `;
        footer += `🔥 <a href="https://pump.fun/${tokenAddress}">Pump.fun</a> | `;
        footer += `📊 <a href="https://solscan.io/token/${tokenAddress}">Solscan</a>\n\n`;
        
        // Add analysis time if timer is available
        if (timer) {
            footer += `<i>Analysis time: ${timer.getElapsedSeconds()}s | ID: ${operationId}</i>`;
        } else {
            footer += `<i>Analysis ID: ${operationId}</i>`;
        }
        
        return footer;
    }

    formatTimeAgo(isoDate) {
        if (!isoDate) return '';
        
        try {
            const now = new Date();
            const published = new Date(isoDate);
            const diffMs = now - published;
            const diffMins = Math.floor(diffMs / (1000 * 60));
            const diffHours = Math.floor(diffMins / 60);
            const diffDays = Math.floor(diffHours / 24);
            
            if (diffMins < 1) {
                return 'now';
            } else if (diffMins < 60) {
                return `${diffMins}m ago`;
            } else if (diffHours < 24) {
                return `${diffHours}h ago`;
            } else if (diffDays < 7) {
                return `${diffDays}d ago`;
            } else {
                return published.toLocaleDateString();
            }
        } catch (error) {
            logger.debug('Error formatting time ago:', error);
            return '';
        }
    }

    getRiskEmoji(riskLevel) {
        const riskEmojis = {
            'LOW': '🟢',
            'MEDIUM': '🟡',
            'HIGH': '🟠',
            'VERY_HIGH': '🔴',
            'UNKNOWN': '⚪'
        };
        return riskEmojis[riskLevel] || riskEmojis['UNKNOWN'];
    }

    truncateMessage(message) {
        if (message.length <= this.config.maxMessageLength) {
            return message;
        }
        
        const truncated = message.substring(0, this.config.maxMessageLength - 100);
        const lastNewline = truncated.lastIndexOf('\n');
        
        return truncated.substring(0, lastNewline) + '\n\n<i>... (message truncated)</i>';
    }

    async sendMessage(channelId, message, options = {}) {
        if (!this.bot) {
            logger.warn('Telegram bot not initialized');
            return;
        }

        const sendOptions = {
            parse_mode: 'HTML',
            disable_web_page_preview: true,
            ...options
        };

        for (let attempt = 1; attempt <= this.config.retryAttempts; attempt++) {
            try {
                const result = await this.bot.sendMessage(channelId, message, sendOptions);
                logger.debug(`Message sent to ${channelId} successfully`);
                return result;
            } catch (error) {
                logger.warn(`Attempt ${attempt}/${this.config.retryAttempts} failed for channel ${channelId}:`, error.message);
                
                if (attempt < this.config.retryAttempts) {
                    await new Promise(resolve => setTimeout(resolve, this.config.retryDelay * attempt));
                } else {
                    logger.error(`Failed to send message to ${channelId} after ${this.config.retryAttempts} attempts`);
                    throw error;
                }
            }
        }
    }

    async publishSimpleAlert(tokenInfo, message, priority = 'normal') {
        if (!this.bot || !this.config.channels.length) {
            return;
        }

        const priorityEmoji = priority === 'high' ? '🚨' : '📢';
        const fullMessage = `${priorityEmoji} <b>${tokenInfo.symbol || 'Token Alert'}</b>\n\n${message}`;

        try {
            const promises = this.config.channels.map(channelId => 
                this.sendMessage(channelId, fullMessage)
            );

            await Promise.allSettled(promises);
            logger.info(`Alert published for ${tokenInfo.symbol}`);
        } catch (error) {
            logger.error('Error publishing alert:', error);
        }
    }

    getStatus() {
        return {
            configured: !!this.bot,
            channels: this.config.channels.length,
            maxMessageLength: this.config.maxMessageLength,
            enablePreviews: this.config.enablePreviews
        };
    }

    // Test method
    async testConfiguration() {
        if (!this.bot || !this.config.channels.length) {
            return { success: false, error: 'Bot or channels not configured' };
        }

        try {
            const testMessage = '🧪 <b>Test Message</b>\n\nTelegram publisher is working correctly!';
            await this.sendMessage(this.config.channels[0], testMessage);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
}

module.exports = TelegramPublisher;