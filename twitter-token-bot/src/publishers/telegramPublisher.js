// src/publishers/telegramPublisher.js
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
            
            logger.info(`📤 Published analysis to ${successful}/${this.config.channels.length} channels`);

        } catch (error) {
            logger.error('Error publishing analysis to Telegram:', error);
        }
    }

    formatAnalysisMessage(analysisResult) {
        const { tokenInfo, twitterMetrics, analyses, operationId } = analysisResult;
        
        // Header with token info
        let message = this.formatHeader(tokenInfo, twitterMetrics);
        
        // Bundle analysis results
        if (analyses.bundle && analyses.bundle.success) {
            message += this.formatBundleAnalysis(analyses.bundle.result);
        }
        
        // Links and footer
        message += this.formatFooter(tokenInfo.address || tokenInfo.mint, operationId, twitterMetrics.link);
        
        // Truncate if too long
        if (message.length > this.config.maxMessageLength) {
            message = this.truncateMessage(message);
        }
        
        return message;
    }

    formatHeader(tokenInfo, twitterMetrics) {
        const symbol = tokenInfo.symbol || 'Unknown';
        const name = tokenInfo.name || 'Unknown Token';
        const eventType = tokenInfo.eventType === 'migration' ? '🔄 MIGRATION' : '🆕 NEW TOKEN';
        
        let header = `${eventType} | <b>${symbol}</b> | ${name}\n`;
        
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
        
        return header;
    }

    formatBundleAnalysis(result) {
        if (!result) return '';
        
        let section = '\n<b>Bundle Analysis:</b>\n';
        
        if (result.bundleDetected) {
            // Count total transactions across all bundles
            const totalTransactions = result.bundles.reduce((sum, bundle) => sum + bundle.transactions.length, 0);
            const totalBoughtPercentage = result.percentageBundled || 0;
            
            // Use the ACTUAL calculated holding percentage
            const currentlyHeldPercentage = result.totalHoldingAmountPercentage || 0;
            
            section += `📦 Total Bundles: ${result.bundles.length}\n`;
            section += `🪙 Total Tokens Bundled: ${this.formatLargeNumber(result.totalTokensBundled)} ${result.tokenInfo?.symbol || 'tokens'} (${totalBoughtPercentage.toFixed(2)}%)\n`;
            section += `🔒 Total Holding Amount: ${this.formatLargeNumber(result.totalHoldingAmount)} ${result.tokenInfo?.symbol || 'tokens'} (${currentlyHeldPercentage.toFixed(2)}%)\n`;
            
            // Get top 5 wallets by holding amount
            const topWallets = this.getTopWalletsByHolding(result.bundles);
            
            if (topWallets.length > 0) {
                section += `Top ${Math.min(5, topWallets.length)} wallets: `;
                const walletLinks = topWallets.slice(0, 5).map(([wallet, holdingAmount]) => {
                    const shortWallet = `${wallet.substring(0, 5)}...${wallet.substring(wallet.length - 4)}`;
                    return `<a href="https://solscan.io/account/${wallet}">${shortWallet}</a>`;
                });
                section += walletLinks.join(', ');
            }
            
            section += '\n\n';
        } else {
            section += '✅ No significant bundling detected\n\n';
        }
        
        return section;
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

    getTopWalletsByHolding(bundles) {
        // Create a map of all wallets and their total holdings across all bundles
        const walletHoldings = new Map();
        
        bundles.forEach(bundle => {
            bundle.uniqueWallets.forEach(wallet => {
                // For each wallet, we need to get their total holding amount
                // Since bundles might share wallets, we need to avoid double counting
                if (!walletHoldings.has(wallet)) {
                    // Find the wallet's total holding from bundle data
                    let walletTotalHolding = 0;
                    bundles.forEach(b => {
                        if (b.uniqueWallets.includes(wallet)) {
                            // Calculate wallet's proportion of this bundle's holding
                            const walletProportion = 1 / b.uniqueWalletsCount; // Simple equal split assumption
                            walletTotalHolding += (b.holdingAmount || 0) * walletProportion;
                        }
                    });
                    walletHoldings.set(wallet, walletTotalHolding);
                }
            });
        });
        
        // Sort by holding amount and return as array of [wallet, amount] pairs
        return Array.from(walletHoldings.entries())
            .sort((a, b) => b[1] - a[1]);
    }

    getTopBundleHolders(bundles) {
        // This method is now replaced by getTopWalletsByHolding but kept for compatibility
        return this.getTopWalletsByHolding(bundles);
    }

    formatFooter(tokenAddress, operationId, twitterLink) {
        let footer = '<b>🔗 Links:</b>\n';
        footer += `🐦 <a href="${twitterLink}">Tweet</a> | `;
        footer += `📈 <a href="https://dexscreener.com/solana/${tokenAddress}">DexScreener</a> | `;
        footer += `🔥 <a href="https://pump.fun/${tokenAddress}">Pump.fun</a> | `;
        footer += `📊 <a href="https://solscan.io/token/${tokenAddress}">Solscan</a>\n\n`;
        footer += `<i>Analysis ID: ${operationId}</i>`;
        
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
        // Method kept for compatibility but not used in clean format
        switch (riskLevel) {
            case 'LOW': return '🟢';
            case 'MEDIUM': return '🟡';
            case 'HIGH': return '🟠';
            case 'VERY_HIGH': return '🔴';
            default: return '⚪';
        }
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
            disable_web_page_preview: true, // Always disable previews to avoid embedded links
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