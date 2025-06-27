// src/services/jsonLogger.js - Enhanced to save bundle and top holders metrics
const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');

class JsonLogger {
    constructor(config = {}) {
        this.config = {
            logsDirectory: config.logsDirectory || path.join(process.cwd(), 'scan_results'),
            maxFileSize: config.maxFileSize || 10 * 1024 * 1024, // 10MB
            ...config
        };

        // Ensure logsDirectory is always a string
        if (!this.config.logsDirectory || typeof this.config.logsDirectory !== 'string') {
            this.config.logsDirectory = path.join(process.cwd(), 'scan_results');
        }

        this.ensureDirectoryExists();
    }

    async ensureDirectoryExists() {
        try {
            await fs.mkdir(this.config.logsDirectory, { recursive: true });
        } catch (error) {
            logger.error('Failed to create scan results directory:', error);
        }
    }

    /**
     * Save scan result - NOW WITH ENHANCED METRICS
     */
    async saveScanResult(analysisResult) {
        try {
            const { tokenInfo, twitterMetrics, operationId, analyses } = analysisResult;
            
            // Base scan data
            const scanData = {
                timestamp: new Date().toISOString(),
                id: operationId,
                eventType: tokenInfo?.eventType || 'creation',
                address: tokenInfo?.address || tokenInfo?.mint || '',
                symbol: tokenInfo?.symbol || 'Unknown',
                name: tokenInfo?.name || 'Unknown',
                tweetLink: twitterMetrics?.link || '',
                likes: twitterMetrics?.likes || 0,
                views: twitterMetrics?.views || 0,
                
                // 🚀 NEW: Enhanced analysis metrics
                analysis: this.extractAnalysisMetrics(analyses)
            };
            
            const eventType = scanData.eventType;
            const filename = `${eventType}_scans.json`;
            const filepath = path.join(this.config.logsDirectory, filename);
            
            await this.appendToJsonFile(filepath, scanData);
            
        } catch (error) {
            // Silent fail - don't spam logs with JSON errors
        }
    }

    /**
     * 🚀 NEW: Extract all relevant analysis metrics for JSON storage
     */
    extractAnalysisMetrics(analyses) {
        const metrics = {
            bundleAnalysis: null,
            topHoldersAnalysis: null,
            success: false,
            totalAnalyses: 0,
            successfulAnalyses: 0
        };

        if (!analyses || typeof analyses !== 'object') {
            return metrics;
        }

        metrics.totalAnalyses = Object.keys(analyses).length;
        metrics.successfulAnalyses = Object.values(analyses).filter(a => a?.success).length;
        metrics.success = metrics.successfulAnalyses > 0;

        // 📦 Bundle Analysis Metrics
        if (analyses.bundle?.success && analyses.bundle.result) {
            const bundle = analyses.bundle.result;
            metrics.bundleAnalysis = {
                detected: bundle.bundleDetected || false,
                bundleCount: bundle.bundles?.length || 0,
                percentageBundled: bundle.percentageBundled || 0,
                totalTokensBundled: bundle.totalTokensBundled || 0,
                totalSolSpent: bundle.totalSolSpent || 0,
                currentlyHeldPercentage: bundle.totalHoldingAmountPercentage || 0,
                currentlyHeldAmount: bundle.totalHoldingAmount || 0
            };
        }

        // 👥 Top Holders Analysis Metrics
        if (analyses.topHolders?.success && analyses.topHolders.result?.summary) {
            const holders = analyses.topHolders.result.summary;
            metrics.topHoldersAnalysis = {
                analyzed: true,
                totalHolders: holders.totalHolders || 20,
                whaleCount: holders.whaleCount || 0,
                freshWalletCount: holders.freshWalletCount || 0,
                regularWalletCount: holders.regularWalletCount || 0,
                whalePercentage: this.safeParseNumber(holders.whalePercentage),
                freshWalletPercentage: this.safeParseNumber(holders.freshWalletPercentage),
                
                // 🎯 CONCENTRATION METRICS - What you specifically requested
                concentration: {
                    top5Holdings: this.safeParseNumber(holders.concentration?.top5Percentage),
                    top10Holdings: this.safeParseNumber(holders.concentration?.top10Percentage), // ⭐ KEY METRIC
                    top20Holdings: this.safeParseNumber(holders.concentration?.top20Percentage)
                },
                
                riskScore: holders.riskScore || 0,
                riskLevel: holders.riskLevel || 'UNKNOWN',
                
                // Additional useful metrics
                flags: holders.flags || [],
                insights: holders.insights || []
            };
        }

        return metrics;
    }

    /**
     * Safely parse percentage values that might be strings or numbers
     */
    safeParseNumber(value) {
        if (value === null || value === undefined) return 0;
        
        // If it's already a number, return it
        if (typeof value === 'number') {
            return value;
        }
        
        // If it's a string, try to parse it
        if (typeof value === 'string') {
            // Remove % sign if present
            const cleaned = value.replace('%', '').trim();
            const parsed = parseFloat(cleaned);
            return isNaN(parsed) ? 0 : parsed;
        }
        
        // Fallback
        return 0;
    }

    async appendToJsonFile(filepath, data) {
        try {
            let existingData = [];
            
            // Try to read existing file
            try {
                const fileContent = await fs.readFile(filepath, 'utf8');
                if (fileContent.trim()) {
                    existingData = JSON.parse(fileContent);
                    if (!Array.isArray(existingData)) {
                        existingData = [existingData];
                    }
                }
            } catch (error) {
                // File doesn't exist, start with empty array
                existingData = [];
            }
            
            // Add new data
            existingData.push(data);
            
            // Check file size and rotate if needed
            const dataSize = JSON.stringify(existingData).length;
            if (dataSize > this.config.maxFileSize) {
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const rotatedPath = filepath.replace('.json', `_${timestamp}.json`);
                await fs.rename(filepath, rotatedPath);
                existingData = [data]; // Start fresh
            }
            
            // Write data
            await fs.writeFile(filepath, JSON.stringify(existingData, null, 2), 'utf8');
            
        } catch (error) {
            // Silent fail
        }
    }

    /**
     * 🚀 NEW: Read and analyze stored metrics
     */
    async getStoredMetrics(eventType = 'both', days = 30) {
        try {
            const files = await fs.readdir(this.config.logsDirectory);
            let targetFiles = files.filter(file => file.endsWith('.json'));

            if (eventType !== 'both') {
                targetFiles = targetFiles.filter(file => file.includes(eventType));
            }

            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - days);

            const allMetrics = [];

            for (const file of targetFiles) {
                try {
                    const filepath = path.join(this.config.logsDirectory, file);
                    const content = await fs.readFile(filepath, 'utf8');
                    const data = JSON.parse(content);
                    const records = Array.isArray(data) ? data : [data];
                    
                    const recentRecords = records.filter(record => {
                        const recordDate = new Date(record.timestamp);
                        return recordDate >= cutoffDate;
                    });
                    
                    allMetrics.push(...recentRecords);
                } catch (error) {
                    logger.debug(`Error reading ${file}: ${error.message}`);
                }
            }

            return this.calculateMetricsStats(allMetrics);

        } catch (error) {
            logger.error('Error getting stored metrics:', error);
            return null;
        }
    }

    /**
     * 🚀 NEW: Calculate statistics from stored metrics
     */
    calculateMetricsStats(records) {
        const stats = {
            total: records.length,
            bundleStats: {
                analyzed: 0,
                detected: 0,
                detectionRate: 0,
                averagePercentageBundled: 0,
                averageCurrentlyHeld: 0,
                highBundleActivity: 0 // >50% bundled
            },
            topHoldersStats: {
                analyzed: 0,
                averageTop10Holdings: 0,
                averageWhaleCount: 0,
                averageFreshWalletCount: 0,
                highConcentration: 0, // >80% top 10
                veryHighConcentration: 0 // >90% top 10
            },
            twitterStats: {
                averageLikes: 0,
                averageViews: 0,
                totalLikes: 0,
                totalViews: 0
            }
        };

        if (records.length === 0) {
            return stats;
        }

        // Bundle statistics
        const bundleRecords = records.filter(r => r.analysis?.bundleAnalysis);
        stats.bundleStats.analyzed = bundleRecords.length;
        
        if (bundleRecords.length > 0) {
            const bundleDetected = bundleRecords.filter(r => r.analysis.bundleAnalysis.detected);
            stats.bundleStats.detected = bundleDetected.length;
            stats.bundleStats.detectionRate = (bundleDetected.length / bundleRecords.length) * 100;
            
            const totalPercentageBundled = bundleRecords.reduce((sum, r) => 
                sum + (r.analysis.bundleAnalysis.percentageBundled || 0), 0);
            stats.bundleStats.averagePercentageBundled = totalPercentageBundled / bundleRecords.length;
            
            const totalCurrentlyHeld = bundleRecords.reduce((sum, r) => 
                sum + (r.analysis.bundleAnalysis.currentlyHeldPercentage || 0), 0);
            stats.bundleStats.averageCurrentlyHeld = totalCurrentlyHeld / bundleRecords.length;
            
            stats.bundleStats.highBundleActivity = bundleRecords.filter(r => 
                (r.analysis.bundleAnalysis.percentageBundled || 0) > 50).length;
        }

        // Top holders statistics
        const holdersRecords = records.filter(r => r.analysis?.topHoldersAnalysis?.analyzed);
        stats.topHoldersStats.analyzed = holdersRecords.length;
        
        if (holdersRecords.length > 0) {
            const totalTop10 = holdersRecords.reduce((sum, r) => 
                sum + (r.analysis.topHoldersAnalysis.concentration?.top10Holdings || 0), 0);
            stats.topHoldersStats.averageTop10Holdings = totalTop10 / holdersRecords.length;
            
            const totalWhales = holdersRecords.reduce((sum, r) => 
                sum + (r.analysis.topHoldersAnalysis.whaleCount || 0), 0);
            stats.topHoldersStats.averageWhaleCount = totalWhales / holdersRecords.length;
            
            const totalFresh = holdersRecords.reduce((sum, r) => 
                sum + (r.analysis.topHoldersAnalysis.freshWalletCount || 0), 0);
            stats.topHoldersStats.averageFreshWalletCount = totalFresh / holdersRecords.length;
            
            stats.topHoldersStats.highConcentration = holdersRecords.filter(r => 
                (r.analysis.topHoldersAnalysis.concentration?.top10Holdings || 0) > 80).length;
            
            stats.topHoldersStats.veryHighConcentration = holdersRecords.filter(r => 
                (r.analysis.topHoldersAnalysis.concentration?.top10Holdings || 0) > 90).length;
        }

        // Twitter statistics
        const totalLikes = records.reduce((sum, r) => sum + (r.likes || 0), 0);
        const totalViews = records.reduce((sum, r) => sum + (r.views || 0), 0);
        
        stats.twitterStats.totalLikes = totalLikes;
        stats.twitterStats.totalViews = totalViews;
        stats.twitterStats.averageLikes = totalLikes / records.length;
        stats.twitterStats.averageViews = totalViews / records.length;

        return stats;
    }
}

module.exports = JsonLogger;