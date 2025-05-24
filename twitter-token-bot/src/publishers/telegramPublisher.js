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
        const { tokenInfo, twitterMetrics, summary, analyses, operationId } = analysisResult;
        
        // Header with token info
        let message = this.formatHeader(tokenInfo, twitterMetrics, summary);
        
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

    formatHeader(tokenInfo, twitterMetrics, summary) {
        const riskEmoji = this.getRiskEmoji(summary.riskLevel);
        const symbol = tokenInfo.symbol || 'Unknown';
        const name = tokenInfo.name || 'Unknown Token';
        
        let header = `${riskEmoji} <b>${symbol}</b> | ${name}\n`;
        header += `📊 Risk Level: <b>${summary.riskLevel}</b> (${Math.round(summary.overallScore)}/100)\n`;
        
        if (twitterMetrics) {
            const likesText = twitterMetrics.likes > 0 ? `${formatNumber(twitterMetrics.likes)} likes` : '';
            const retweetsText = twitterMetrics.retweets > 0 ? `${formatNumber(twitterMetrics.retweets)} RT` : '';
            
            if (likesText || retweetsText) {
                const parts = [likesText, retweetsText].filter(Boolean);
                header += `🐦 Twitter: ${parts.join(' | ')}\n`;
            }
        }
        
        return header;
    }

    formatBundleAnalysis(result) {
        if (!result) return '';
        
        let section = '📦 <b>Bundle Analysis:</b>\n';
        
        if (result.bundleDetected) {
            section += `🔴 Bundle detected: ${result.percentageBundled?.toFixed(2)}% of supply\n`;
            section += `💰 ${formatNumber(result.totalTokensBundled)} tokens bundled\n`;
            section += `💎 ${result.totalSolSpent?.toFixed(2)} SOL spent\n\n`;
            
            // Add condensed bundle summary
            section += this.formatCondensedBundleSummary(result);
        } else {
            section += '✅ No significant bundling detected\n';
        }
        
        return section;
    }

    formatCondensedBundleSummary(result) {
        const totalTransactions = result.bundles.reduce((sum, bundle) => sum + bundle.transactions.length, 0);
        const totalBoughtPercentage = result.percentageBundled || 0;
        
        // For now, assume currently held is same as bought (we'd need current balance data to be accurate)
        const currentlyHeldPercentage = totalBoughtPercentage; // This would need actual current balance checking
        
        // Get top 5 bundle holders (by tokens bought in bundles)
        const allBundleWallets = new Map();
        
        result.bundles.forEach(bundle => {
            bundle.transactions.forEach(tx => {
                const wallet = tx.user;
                const tokens = tx.token_amount / 1000000; // Convert from raw to tokens
                allBundleWallets.set(wallet, (allBundleWallets.get(wallet) || 0) + tokens);
            });
        });
        
        // Sort by tokens held and get top 5
        const topHolders = Array.from(allBundleWallets.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);
        
        let summary = `<b>Bundle Summary:</b>\n`;
        summary += `Total Bundle Transactions: ${totalTransactions}\n`;
        summary += `Total Bought: ${totalBoughtPercentage.toFixed(2)}%\n`;
        summary += `Currently Held: ${currentlyHeldPercentage.toFixed(2)}%\n`;
        
        if (topHolders.length > 0) {
            summary += `Top 5 addresses: `;
            const addressLinks = topHolders.map(([wallet, tokens]) => {
                const shortWallet = `${wallet.substring(0, 5)}...${wallet.substring(wallet.length - 4)}`;
                return `<a href="https://solscan.io/account/${wallet}">${shortWallet}</a>`;
            });
            summary += addressLinks.join(', ');
        }
        
        return summary + '\n';
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

    getRiskEmoji(riskLevel) {
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