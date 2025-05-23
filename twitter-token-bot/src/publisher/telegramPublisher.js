// src/publishers/telegramPublisher.js
const logger = require('../utils/logger');
const { formatNumber } = require('../bot/formatters/generalFormatters');

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
        
        // Header
        let message = this.formatHeader(tokenInfo, twitterMetrics, summary);
        
        // Risk assessment
        message += this.formatRiskAssessment(summary);
        
        // Flags and warnings
        if (summary.flags.length > 0) {
            message += this.formatFlags(summary.flags);
        }
        
        // Analysis details
        message += this.formatAnalysisDetails(analyses);
        
        // Links and footer
        message += this.formatFooter(tokenInfo.address || tokenInfo.mint, operationId);
        
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
            header += `🐦 Twitter: ${formatNumber(twitterMetrics.views)} views`;
            if (twitterMetrics.likes > 0) {
                header += ` | ${formatNumber(twitterMetrics.likes)} likes`;
            }
            if (twitterMetrics.retweets > 0) {
                header += ` | ${formatNumber(twitterMetrics.retweets)} RTs`;
            }
            header += '\n';
        }
        
        header += '\n';
        return header;
    }

    formatRiskAssessment(summary) {
        let assessment = '<b>📋 Analysis Summary:</b>\n';
        assessment += `✅ Successful: ${summary.successfulAnalyses}/${summary.totalAnalyses} analyses\n`;
        
        if (summary.failedAnalyses > 0) {
            assessment += `❌ Failed: ${summary.failedAnalyses} analyses\n`;
        }
        
        assessment += '\n';
        return assessment;
    }

    formatFlags(flags) {
        let flagSection = '<b>⚠️ Key Findings:</b>\n';
        flags.forEach(flag => {
            flagSection += `${flag}\n`;
        });
        flagSection += '\n';
        return flagSection;
    }

    formatAnalysisDetails(analyses) {
        let details = '<b>🔍 Detailed Analysis:</b>\n';
        
        Object.values(analyses).forEach(analysis => {
            if (analysis.success) {
                details += this.formatSingleAnalysis(analysis);
            }
        });
        
        return details;
    }

    formatSingleAnalysis(analysis) {
        const { type, result, duration } = analysis;
        let section = '';
        
        switch (type) {
            case 'bundle':
                section += this.formatBundleAnalysis(result);
                break;
            case 'topHolders':
                section += this.formatTopHoldersAnalysis(result);
                break;
            case 'devAnalysis':
                section += this.formatDevAnalysis(result);
                break;
            case 'teamSupply':
                section += this.formatTeamSupplyAnalysis(result);
                break;
            case 'freshWallets':
                section += this.formatFreshWalletsAnalysis(result);
                break;
        }
        
        return section;
    }

    formatBundleAnalysis(result) {
        if (!result) return '';
        
        let section = '📦 <b>Bundle Analysis:</b>\n';
        
        if (result.bundleDetected) {
            section += `🔴 Bundle detected: ${result.percentageBundled?.toFixed(2)}% of supply\n`;
            section += `💰 ${formatNumber(result.totalTokensBundled)} tokens bundled\n`;
            section += `💎 ${result.totalSolSpent?.toFixed(2)} SOL spent\n`;
        } else {
            section += '✅ No significant bundling detected\n';
        }
        
        section += '\n';
        return section;
    }

    formatTopHoldersAnalysis(result) {
        if (!result) return '';
        
        let section = '👥 <b>Top Holders:</b>\n';
        section += `📊 Top holders control ${result.totalSupplyControlled?.toFixed(2)}% of supply\n`;
        
        if (result.filteredWallets && result.filteredWallets.length > 0) {
            const interestingWallets = result.filteredWallets.filter(w => w.isInteresting);
            if (interestingWallets.length > 0) {
                section += `🎯 ${interestingWallets.length} notable wallets found\n`;
            }
        }
        
        section += '\n';
        return section;
    }

    formatDevAnalysis(result) {
        if (!result || !result.success) return '';
        
        let section = '👨‍💻 <b>Dev Analysis:</b>\n';
        
        if (result.coinsStats) {
            const { totalCoins, bondedCount, bondedPercentage } = result.coinsStats;
            section += `🏗️ Created ${totalCoins} tokens (${bondedPercentage}% bonded)\n`;
            
            if (bondedCount > 0) {
                section += `✅ ${bondedCount} successful launches\n`;
            }
        }
        
        if (result.ownerTokenStats) {
            const { holdingPercentage } = result.ownerTokenStats;
            if (holdingPercentage > 0) {
                section += `💼 Dev holds ${holdingPercentage}% of supply\n`;
            }
        }
        
        if (result.transferConnections && result.transferConnections.length > 0) {
            const exchanges = result.transferConnections.filter(conn => conn.label);
            if (exchanges.length > 0) {
                section += `🏦 Connected to ${exchanges[0].label}\n`;
            }
        }
        
        section += '\n';
        return section;
    }

    formatTeamSupplyAnalysis(result) {
        if (!result?.scanData) return '';
        
        let section = '👨‍👨‍👧‍👦 <b>Team Supply:</b>\n';
        section += `🎯 Team controls ${result.scanData.totalSupplyControlled?.toFixed(2)}% of supply\n`;
        
        if (result.scanData.teamWallets && result.scanData.teamWallets.length > 0) {
            section += `👤 ${result.scanData.teamWallets.length} team wallets identified\n`;
            
            // Show breakdown by category
            const categories = {};
            result.scanData.teamWallets.forEach(wallet => {
                categories[wallet.category] = (categories[wallet.category] || 0) + 1;
            });
            
            Object.entries(categories).forEach(([category, count]) => {
                section += `   • ${count} ${category.toLowerCase()} wallet${count > 1 ? 's' : ''}\n`;
            });
        }
        
        section += '\n';
        return section;
    }

    formatFreshWalletsAnalysis(result) {
        if (!result?.scanData) return '';
        
        let section = '🆕 <b>Fresh Wallets:</b>\n';
        section += `🎯 Fresh wallets hold ${result.scanData.totalSupplyControlled?.toFixed(2)}% of supply\n`;
        
        if (result.scanData.freshWallets && result.scanData.freshWallets.length > 0) {
            section += `👶 ${result.scanData.freshWallets.length} fresh wallets found\n`;
            
            // Show top fresh wallets by percentage
            const topFresh = result.scanData.freshWallets
                .sort((a, b) => b.percentage - a.percentage)
                .slice(0, 3);
                
            topFresh.forEach(wallet => {
                section += `   • ${wallet.percentage.toFixed(2)}% supply\n`;
            });
        }
        
        section += '\n';
        return section;
    }

    formatFooter(tokenAddress, operationId) {
        let footer = '<b>🔗 Links:</b>\n';
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
            disable_web_page_preview: !this.config.enablePreviews,
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

    async sendPhoto(channelId, photo, caption = '', options = {}) {
        if (!this.bot) {
            logger.warn('Telegram bot not initialized');
            return;
        }

        const sendOptions = {
            caption,
            parse_mode: 'HTML',
            ...options
        };

        try {
            return await this.bot.sendPhoto(channelId, photo, sendOptions);
        } catch (error) {
            logger.error(`Failed to send photo to ${channelId}:`, error);
            throw error;
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

module.exports = TelegramPublisher;;