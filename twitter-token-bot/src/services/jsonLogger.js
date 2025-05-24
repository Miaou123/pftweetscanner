// src/services/jsonLogger.js
const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');

class JsonLogger {
    constructor(config = {}) {
        this.config = {
            logsDirectory: config.logsDirectory || path.join(process.cwd(), 'scan_results'),
            maxFileSize: config.maxFileSize || 50 * 1024 * 1024, // 50MB
            maxFiles: config.maxFiles || 10,
            rotateDaily: config.rotateDaily !== false,
            ...config
        };

        // Ensure logsDirectory is always a string
        if (!this.config.logsDirectory || typeof this.config.logsDirectory !== 'string') {
            this.config.logsDirectory = path.join(process.cwd(), 'scan_results');
            logger.warn('Invalid logsDirectory config, using default: scan_results/');
        }

        this.ensureDirectoryExists();
    }

    async ensureDirectoryExists() {
        try {
            await fs.mkdir(this.config.logsDirectory, { recursive: true });
            logger.info(`📁 JSON logs directory ready: ${this.config.logsDirectory}`);
        } catch (error) {
            logger.error('Failed to create JSON logs directory:', error);
        }
    }

    /**
     * Save scan result to appropriate JSON file
     * @param {Object} analysisResult - Complete analysis result from orchestrator
     */
    async saveScanResult(analysisResult) {
        try {
            const { tokenInfo, twitterMetrics, analyses, summary, operationId, timer } = analysisResult;
            
            // Fix: Ensure we have a valid eventType, default to 'creation'
            let eventType = tokenInfo?.eventType || 'creation';
            
            // Validate eventType
            if (!eventType || !['creation', 'migration'].includes(eventType)) {
                logger.warn(`Invalid eventType: ${eventType}, defaulting to 'creation'`);
                eventType = 'creation';
            }
            
            // Create structured data matching Telegram display
            const scanData = this.formatScanData(analysisResult);
            
            // Get appropriate filename
            const filename = this.getFilename(eventType);
            const filepath = path.join(this.config.logsDirectory, filename);
            
            // Save to file
            await this.appendToJsonFile(filepath, scanData);
            
            logger.debug(`💾 [${operationId}] Scan result saved to ${filename}`);
            
        } catch (error) {
            logger.error('Error saving scan result to JSON:', error);
        }
    }

    /**
     * Format analysis result into structured JSON data
     */
    formatScanData(analysisResult) {
        const { tokenInfo, twitterMetrics, analyses, summary, operationId, timer, startTime, endTime, duration } = analysisResult;
        
        const scanData = {
            // Metadata
            id: operationId,
            timestamp: new Date().toISOString(),
            scanStartTime: startTime ? new Date(startTime).toISOString() : null,
            scanEndTime: endTime ? new Date(endTime).toISOString() : null,
            scanDuration: duration || null,
            eventType: tokenInfo.eventType || 'creation',
            
            // Token Information
            token: {
                symbol: tokenInfo.symbol || 'Unknown',
                name: tokenInfo.name || 'Unknown Token',
                address: tokenInfo.address || tokenInfo.mint || '',
                creator: tokenInfo.creator || tokenInfo.traderPublicKey || null
            },
            
            // Twitter Metrics (as displayed)
            twitter: {
                link: twitterMetrics?.link || null,
                views: twitterMetrics?.views || 0,
                likes: twitterMetrics?.likes || 0,
                publishedAt: twitterMetrics?.publishedAt || null,
                timeAgo: this.formatTimeAgo(twitterMetrics?.publishedAt),
                displayText: this.formatTwitterDisplay(twitterMetrics)
            },
            
            // Analysis Results
            analysis: {
                success: analysisResult.success || false,
                totalAnalyses: summary?.totalAnalyses || 0,
                successfulAnalyses: summary?.successfulAnalyses || 0,
                
                // Bundle Analysis
                bundle: this.formatBundleData(analyses.bundle),
                
                // Top Holders Analysis  
                topHolders: this.formatTopHoldersData(analyses.topHolders),
                
                // Summary flags and alerts
                flags: summary?.flags || [],
                alerts: summary?.alerts || [],
                riskLevel: summary?.riskLevel || 'UNKNOWN',
                overallScore: summary?.overallScore || 0
            },
            
            // Links (as shown in Telegram)
            links: {
                tweet: twitterMetrics?.link || '',
                dexscreener: `https://dexscreener.com/solana/${tokenInfo.address || tokenInfo.mint}`,
                pumpfun: `https://pump.fun/${tokenInfo.address || tokenInfo.mint}`,
                solscan: `https://solscan.io/token/${tokenInfo.address || tokenInfo.mint}`
            },
            
            // Error information (if any)
            errors: analysisResult.errors || [],
            
            // Raw analysis data (for debugging/future use)
            rawData: {
                bundleResult: analyses.bundle?.result || null,
                topHoldersResult: analyses.topHolders?.result || null,
                analysisError: summary?.analysisError || false
            }
        };
        
        return scanData;
    }

    formatBundleData(bundleAnalysis) {
        if (!bundleAnalysis?.success || !bundleAnalysis.result) {
            return {
                analyzed: false,
                success: bundleAnalysis?.success || false,
                error: bundleAnalysis?.error || 'Analysis failed',
                detected: false
            };
        }

        const result = bundleAnalysis.result;
        return {
            analyzed: true,
            success: true,
            detected: result.bundleDetected || false,
            bundleCount: result.bundles?.length || 0,
            tokensBundled: result.totalTokensBundled || 0,
            percentageBundled: result.percentageBundled || 0,
            currentlyHeld: result.totalHoldingAmount || 0,
            currentlyHeldPercentage: result.totalHoldingAmountPercentage || 0,
            solSpent: result.totalSolSpent || 0,
            displayText: this.formatBundleDisplay(result)
        };
    }

    formatTopHoldersData(topHoldersAnalysis) {
        if (!topHoldersAnalysis?.success || !topHoldersAnalysis.result?.summary) {
            return {
                analyzed: false,
                success: topHoldersAnalysis?.success || false,
                error: topHoldersAnalysis?.error || 'Analysis failed'
            };
        }

        const summary = topHoldersAnalysis.result.summary;
        return {
            analyzed: true,
            success: true,
            totalHolders: summary.totalHolders || 0,
            whaleCount: summary.whaleCount || 0,
            whalePercentage: summary.whalePercentage || '0',
            freshWalletCount: summary.freshWalletCount || 0,
            freshWalletPercentage: summary.freshWalletPercentage || '0',
            highValueCount: summary.highValueCount || 0,
            regularWalletCount: summary.regularWalletCount || 0,
            concentration: {
                top5: summary.concentration?.top5Percentage || '0',
                top10: summary.concentration?.top10Percentage || '0',
                top20: summary.concentration?.top20Percentage || '0'
            },
            riskScore: summary.riskScore || 0,
            riskLevel: summary.riskLevel || 'UNKNOWN',
            flags: summary.flags || [],
            displayText: this.formatTopHoldersDisplay(summary)
        };
    }

    formatTwitterDisplay(twitterMetrics) {
        if (!twitterMetrics) return '';
        
        const parts = [];
        
        if (twitterMetrics.views && twitterMetrics.views > 0) {
            parts.push(`👀 ${this.formatNumber(twitterMetrics.views)} views`);
        }
        
        if (twitterMetrics.likes && twitterMetrics.likes > 0) {
            parts.push(`❤️ ${this.formatNumber(twitterMetrics.likes)} likes`);
        }
        
        let display = parts.join(' • ');
        
        if (twitterMetrics.publishedAt) {
            const timeAgo = this.formatTimeAgo(twitterMetrics.publishedAt);
            display += ` • 📅 ${timeAgo}`;
        }
        
        return display;
    }

    formatBundleDisplay(result) {
        if (!result?.bundleDetected) {
            return '✅ No significant bundling detected';
        }
        
        return `• Bundles Found: ${result.bundles?.length || 0}
• Tokens Bundled: ${this.formatLargeNumber(result.totalTokensBundled)} (${(result.percentageBundled || 0).toFixed(2)}%)
• Currently Held: ${this.formatLargeNumber(result.totalHoldingAmount)} (${(result.totalHoldingAmountPercentage || 0).toFixed(2)}%)`;
    }

    formatTopHoldersDisplay(summary) {
        if (!summary || summary.totalHolders === 0) {
            return '• Analysis incomplete (insufficient holder data)';
        }
        
        return `• 🐋 Whales: ${summary.whaleCount}/20 (${summary.whalePercentage}%)
• 🆕 Fresh Wallets: ${summary.freshWalletCount}/20 (${summary.freshWalletPercentage}%)
• Top 10 Holdings: ${summary.concentration?.top10Percentage}%`;
    }

    formatNumber(num) {
        if (num === null || num === undefined || isNaN(num)) return '0';
        
        const absNum = Math.abs(num);
        if (absNum >= 1000000) return (num / 1000000).toFixed(1) + 'M';
        if (absNum >= 1000) return (num / 1000).toFixed(1) + 'K';
        return Math.round(num).toLocaleString();
    }

    formatLargeNumber(num) {
        if (!num || isNaN(num)) return '0';
        
        if (num >= 1000000000) return (num / 1000000000).toFixed(1) + 'B';
        if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
        if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
        return Math.round(num).toString();
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
            
            if (diffMins < 1) return 'now';
            if (diffMins < 60) return `${diffMins}m ago`;
            if (diffHours < 24) return `${diffHours}h ago`;
            if (diffDays < 7) return `${diffDays}d ago`;
            return published.toLocaleDateString();
        } catch (error) {
            return '';
        }
    }

    /**
     * Generate filename based on event type and date
     */
    getFilename(eventType) {
        // Ensure eventType is valid
        if (!eventType || !['creation', 'migration'].includes(eventType)) {
            logger.warn(`Invalid eventType for filename: ${eventType}, using 'creation'`);
            eventType = 'creation';
        }
        
        const dateStr = this.config.rotateDaily ? 
            new Date().toISOString().split('T')[0] : // YYYY-MM-DD
            'all';
        
        return `${eventType}_scans_${dateStr}.json`;
    }

    /**
     * Append data to JSON file (creates array structure)
     */
    async appendToJsonFile(filepath, data) {
        try {
            let existingData = [];
            
            // Try to read existing file
            try {
                const fileContent = await fs.readFile(filepath, 'utf8');
                if (fileContent.trim()) {
                    existingData = JSON.parse(fileContent);
                    if (!Array.isArray(existingData)) {
                        existingData = [existingData]; // Convert single object to array
                    }
                }
            } catch (error) {
                // File doesn't exist or is empty, start with empty array
                existingData = [];
            }
            
            // Add new data
            existingData.push(data);
            
            // Check file size and rotate if needed
            await this.checkAndRotateFile(filepath, existingData);
            
            // Write updated data
            await fs.writeFile(filepath, JSON.stringify(existingData, null, 2), 'utf8');
            
        } catch (error) {
            logger.error(`Error writing to JSON file ${filepath}:`, error);
        }
    }

    /**
     * Check file size and rotate if needed
     */
    async checkAndRotateFile(filepath, data) {
        try {
            const dataSize = JSON.stringify(data).length;
            
            if (dataSize > this.config.maxFileSize) {
                // Create rotated filename
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const rotatedPath = filepath.replace('.json', `_${timestamp}.json`);
                
                // Move current file
                try {
                    await fs.rename(filepath, rotatedPath);
                    logger.info(`📁 Rotated JSON log file: ${path.basename(rotatedPath)}`);
                } catch (error) {
                    logger.warn('Failed to rotate JSON log file:', error);
                }
                
                // Clean up old files
                await this.cleanupOldFiles(path.dirname(filepath));
            }
        } catch (error) {
            logger.error('Error during file rotation:', error);
        }
    }

    /**
     * Clean up old rotated files
     */
    async cleanupOldFiles(directory) {
        try {
            const files = await fs.readdir(directory);
            const jsonFiles = files
                .filter(file => file.endsWith('.json') && file.includes('_scans_'))
                .map(file => ({
                    name: file,
                    path: path.join(directory, file),
                    stat: null
                }));
            
            // Get file stats
            for (const file of jsonFiles) {
                try {
                    file.stat = await fs.stat(file.path);
                } catch (error) {
                    // Skip files we can't stat
                    continue;
                }
            }
            
            // Sort by modification time (newest first)
            const validFiles = jsonFiles
                .filter(file => file.stat)
                .sort((a, b) => b.stat.mtime - a.stat.mtime);
            
            // Delete files beyond max count
            if (validFiles.length > this.config.maxFiles) {
                const filesToDelete = validFiles.slice(this.config.maxFiles);
                
                for (const file of filesToDelete) {
                    try {
                        await fs.unlink(file.path);
                        logger.debug(`🗑️ Deleted old JSON log: ${file.name}`);
                    } catch (error) {
                        logger.warn(`Failed to delete ${file.name}:`, error);
                    }
                }
            }
            
        } catch (error) {
            logger.error('Error cleaning up old JSON files:', error);
        }
    }

    /**
     * Get statistics about JSON logs
     */
    async getStats() {
        try {
            const files = await fs.readdir(this.config.logsDirectory);
            const jsonFiles = files.filter(file => file.endsWith('.json'));
            
            const stats = {
                totalFiles: jsonFiles.length,
                creationFiles: jsonFiles.filter(file => file.includes('creation')).length,
                migrationFiles: jsonFiles.filter(file => file.includes('migration')).length,
                files: []
            };
            
            for (const file of jsonFiles) {
                try {
                    const filepath = path.join(this.config.logsDirectory, file);
                    const stat = await fs.stat(filepath);
                    const content = await fs.readFile(filepath, 'utf8');
                    const data = JSON.parse(content);
                    
                    stats.files.push({
                        name: file,
                        size: stat.size,
                        modified: stat.mtime,
                        records: Array.isArray(data) ? data.length : 1
                    });
                } catch (error) {
                    // Skip files we can't read
                    continue;
                }
            }
            
            return stats;
        } catch (error) {
            logger.error('Error getting JSON log stats:', error);
            return { totalFiles: 0, creationFiles: 0, migrationFiles: 0, files: [] };
        }
    }

    /**
     * Read scan results from file
     */
    async readScanResults(eventType, date = null) {
        try {
            const filename = date ? 
                `${eventType}_scans_${date}.json` : 
                `${eventType}_scans_${new Date().toISOString().split('T')[0]}.json`;
            
            const filepath = path.join(this.config.logsDirectory, filename);
            const content = await fs.readFile(filepath, 'utf8');
            
            return JSON.parse(content);
        } catch (error) {
            logger.debug(`Could not read scan results from ${filename}:`, error.message);
            return [];
        }
    }
}

module.exports = JsonLogger;