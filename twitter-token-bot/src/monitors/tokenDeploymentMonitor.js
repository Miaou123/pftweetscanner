// src/monitors/tokenDeploymentMonitor.js - CORRECTED VERSION
const EventEmitter = require('events');
const logger = require('../utils/logger');
const SocialMediaManager = require('../validators/socialMediaManager');
const AnalysisOrchestrator = require('../orchestrators/analysisOrchestrator');
const { getSolanaApi } = require('../integrations/solanaApi');

class TokenDeploymentMonitor extends EventEmitter {
    constructor(config = {}) {
        super();
        
        this.config = {
            minTwitterViews: parseInt(process.env.MIN_TWITTER_VIEWS) || config.minTwitterViews || 100000,
            minTwitterLikes: parseInt(process.env.MIN_TWITTER_LIKES) || config.minTwitterLikes || 100,
            analysisTimeout: parseInt(process.env.ANALYSIS_TIMEOUT) || config.analysisTimeout || 3 * 60 * 1000,
            maxConcurrentAnalyses: parseInt(process.env.MAX_CONCURRENT_ANALYSES) || config.maxConcurrentAnalyses || 2,
            processingDelay: parseInt(process.env.PROCESSING_DELAY) || config.processingDelay || 1000,
            enableViewCountExtraction: config.enableViewCountExtraction !== false,
            viewCountTimeout: config.viewCountTimeout || 10000,
            ...config
        };

        logger.info(`📋 TokenDeploymentMonitor Config:`);
        logger.info(`   • Min Twitter Views: ${this.config.minTwitterViews.toLocaleString()}`);
        logger.info(`   • Min Twitter Likes: ${this.config.minTwitterLikes.toLocaleString()}`);
        logger.info(`   • 🎵 TikTok Auto-Qualification: Enabled`);
        logger.info(`   • View Count Extraction: ${this.config.enableViewCountExtraction ? 'Enabled' : 'Disabled'}`);

        // Use SocialMediaManager instead of TwitterValidator
        this.socialMediaManager = new SocialMediaManager({
            enableViewCountExtraction: this.config.enableViewCountExtraction,
            viewCountTimeout: this.config.viewCountTimeout,
            quickTimeout: 3000
        });
        
        this.analysisOrchestrator = new AnalysisOrchestrator({
            ...this.config,
            botType: 'creation'
        });
        
        this.solanaApi = getSolanaApi();
        
        // State management
        this.processedTokens = new Set();
        this.processingQueue = [];
        this.currentlyAnalyzing = new Set();
        this.isProcessing = false;
        
        // Enhanced stats with TikTok tracking
        this.stats = {
            tokensReceived: 0,
            tokensProcessed: 0,
            tokensSkipped: 0,
            tokensAnalyzed: 0,
            tiktokAutoQualified: 0,
            twitterQualified: 0,
            viewCountsExtracted: 0,
            socialMediaFailures: 0, // ✅ FIXED: Used consistently
            errors: 0
        };

        // Bind methods
        this.processNewToken = this.processNewToken.bind(this);
        this.processQueue = this.processQueue.bind(this);
        
        // Start processors
        this.startQueueProcessor();
        this.startMemoryCleanup();
        this.setupShutdownCleanup();
    }

    async processNewToken(tokenEvent) {
        const timer = tokenEvent.timer;
        
        try {
            this.stats.tokensReceived++;
            logger.info(`🔍 Processing new token: ${tokenEvent.name} (${tokenEvent.symbol}) - ${tokenEvent.mint}`);
            
            // Basic validation
            if (!this.validateTokenEvent(tokenEvent)) {
                logger.debug(`Invalid token event structure for ${tokenEvent.mint}`);
                this.stats.tokensSkipped++;
                return;
            }

            // Duplicate check
            if (this.processedTokens.has(tokenEvent.mint)) {
                logger.debug(`Token ${tokenEvent.mint} already processed, skipping`);
                this.stats.tokensSkipped++;
                return;
            }

            this.processedTokens.add(tokenEvent.mint);

            // Use SocialMediaManager for extraction and quick check
            const socialResult = await this.socialMediaManager.quickEngagementCheck(tokenEvent);

            if (!socialResult) {
                logger.debug(`No valid social URL found for ${tokenEvent.symbol}`);
                this.stats.tokensSkipped++;
                return;
            }

            const { url: socialUrl, platform, metrics: socialMetrics, autoQualified } = socialResult;

            // 🎵 TikTok Auto-Qualification Path
            if (platform === 'tiktok') {
                logger.info(`🎵 TikTok link detected for ${tokenEvent.symbol}: ${socialUrl}`);
                logger.info(`🚀 AUTO-QUALIFYING ${tokenEvent.symbol} - TikTok has viral potential!`);
                
                this.stats.tiktokAutoQualified++;
                
                // Add to processing queue immediately
                this.processingQueue.push({
                    tokenEvent,
                    socialUrl,
                    socialMetrics,
                    platform: 'tiktok',
                    autoQualified: true,
                    timestamp: Date.now(),
                    timer
                });

                this.stats.tokensProcessed++;
                logger.info(`🎵 ${tokenEvent.symbol} queued for analysis with TikTok auto-qualification. Queue size: ${this.processingQueue.length}`);
                return;
            }

            // 🐦 Twitter Engagement Check Path
            if (platform === 'twitter') {
                logger.info(`📱 Twitter link found for ${tokenEvent.symbol}: ${socialUrl}`);

                if (!socialMetrics || !socialMetrics.likes) {
                    logger.info(`❌ Twitter validation failed for ${tokenEvent.symbol}`);
                    this.stats.socialMediaFailures++; // ✅ FIXED: Using consistent variable
                    this.stats.tokensSkipped++;
                    return;
                }

                logger.info(`⚡ ${socialMetrics.likes} likes found for ${tokenEvent.symbol}`);

                // Check engagement threshold for Twitter
                if (socialMetrics.likes < this.config.minTwitterLikes) {
                    logger.info(`❌ ${tokenEvent.symbol} has ${socialMetrics.likes} likes (< ${this.config.minTwitterLikes}), skipping`);
                    this.stats.tokensSkipped++;
                    return;
                }

                // Twitter qualified!
                logger.info(`🚀 ${tokenEvent.symbol} qualified with ${socialMetrics.likes} Twitter likes! Starting analysis...`);
                this.stats.twitterQualified++;

                // Add to processing queue
                this.processingQueue.push({
                    tokenEvent,
                    socialUrl,
                    socialMetrics,
                    platform: 'twitter',
                    autoQualified: false,
                    timestamp: Date.now(),
                    timer
                });

                this.stats.tokensProcessed++;
                logger.debug(`Twitter-qualified ${tokenEvent.symbol} queued. Queue size: ${this.processingQueue.length}`);
            }

        } catch (error) {
            logger.error(`Error processing new token ${tokenEvent.mint}:`, error);
            this.stats.errors++;
        }
    }

    async processQueueItem(item) {
        const { tokenEvent, socialUrl, socialMetrics, platform, autoQualified, timestamp, timer } = item;
        const operationId = timer.operationId;

        try {
            logger.info(`🔄 [${operationId}] Processing: ${tokenEvent.symbol} (${platform.toUpperCase()}${autoQualified ? ' - AUTO-QUALIFIED' : ''})`);

            // Check if item is too old (10 minutes)
            if (Date.now() - timestamp > 10 * 60 * 1000) {
                logger.warn(`[${operationId}] Item too old, skipping: ${tokenEvent.symbol}`);
                this.stats.tokensSkipped++;
                return;
            }

            // Check concurrent limit
            if (this.currentlyAnalyzing.size >= this.config.maxConcurrentAnalyses) {
                logger.warn(`[${operationId}] Max concurrent analyses reached, requeuing`);
                setTimeout(() => {
                    this.processingQueue.unshift(item);
                }, 30000);
                return;
            }

            this.currentlyAnalyzing.add(tokenEvent.mint);

            try {
                let finalSocialMetrics = socialMetrics;

                // 🎵 TikTok: Skip expensive operations, already auto-qualified
                if (platform === 'tiktok') {
                    logger.info(`[${operationId}] 🎵 TikTok link - skipping engagement extraction, using auto-qualified metrics`);
                }
                // 🐦 Twitter: Get full metrics including views if enabled
                else if (platform === 'twitter' && this.config.enableViewCountExtraction) {
                    logger.info(`[${operationId}] 📊 Extracting Twitter view count...`);
                    try {
                        const viewStart = Date.now();
                        // Use SocialMediaManager for full validation
                        const fullMetrics = await this.socialMediaManager.validateEngagementForPlatform(socialUrl, 'twitter');
                        const viewTime = Date.now() - viewStart;
                        
                        if (fullMetrics && (fullMetrics.views > 0 || fullMetrics.likes > socialMetrics.likes)) {
                            finalSocialMetrics = fullMetrics;
                            this.stats.viewCountsExtracted++;
                            logger.info(`[${operationId}] ✅ Views extracted (${viewTime}ms): ${finalSocialMetrics.views} views, ${finalSocialMetrics.likes} likes`);
                        } else {
                            logger.warn(`[${operationId}] ⚠️ View extraction failed (${viewTime}ms)`);
                        }
                    } catch (error) {
                        logger.warn(`[${operationId}] ⚠️ View extraction error: ${error.message}`);
                    }
                }

                // Run token analysis
                logger.info(`[${operationId}] 🔬 Running token analysis...`);
                const analysisStart = Date.now();
                
                const analysisResult = await this.analysisOrchestrator.analyzeToken({
                    tokenAddress: tokenEvent.mint,
                    tokenInfo: {
                        name: tokenEvent.name,
                        symbol: tokenEvent.symbol,
                        creator: tokenEvent.traderPublicKey || tokenEvent.creator,
                        address: tokenEvent.mint,
                        eventType: 'creation'
                    },
                    twitterMetrics: finalSocialMetrics, // Keep name for compatibility
                    operationId,
                    timer
                });
                
                const analysisTime = Date.now() - analysisStart;

                // Handle result
                if (analysisResult.success) {
                    const platformEmoji = platform === 'tiktok' ? '🎵' : '🐦';
                    logger.info(`✅ [${operationId}] Analysis completed (${analysisTime}ms) - ${platformEmoji} ${platform.toUpperCase()}`);
                    this.stats.tokensAnalyzed++;
                    
                    this.emit('analysisCompleted', {
                        tokenEvent,
                        twitterMetrics: finalSocialMetrics, // Keep name for compatibility
                        socialMetrics: finalSocialMetrics,   // New field with platform info
                        platform,
                        autoQualified,
                        analysisResult,
                        operationId
                    });
                } else {
                    logger.error(`❌ [${operationId}] Analysis failed: ${analysisResult.error}`);
                    this.stats.errors++;
                }

            } finally {
                this.currentlyAnalyzing.delete(tokenEvent.mint);
            }

        } catch (error) {
            logger.error(`[${operationId}] Analysis error:`, error);
            this.stats.errors++;
        }
    }

    validateTokenEvent(tokenEvent) {
        return tokenEvent && 
               tokenEvent.mint && 
               typeof tokenEvent.mint === 'string' && 
               tokenEvent.mint.trim().length > 0;
    }

    startQueueProcessor() {
        setInterval(async () => {
            if (!this.isProcessing && this.processingQueue.length > 0) {
                await this.processQueue();
            }
        }, this.config.processingDelay);

        logger.info(`Queue processor started with ${this.config.processingDelay}ms interval`);
    }

    async processQueue() {
        if (this.isProcessing || this.processingQueue.length === 0) {
            return;
        }

        this.isProcessing = true;

        try {
            const batchSize = Math.min(5, this.processingQueue.length);
            const batch = this.processingQueue.splice(0, batchSize);

            logger.info(`Processing batch of ${batch.length} items`);

            const validItems = batch.filter(item => {
                const age = Date.now() - item.timestamp;
                if (age > 10 * 60 * 1000) {
                    logger.debug(`Filtering out old item: ${item.tokenEvent.symbol}`);
                    this.stats.tokensSkipped++;
                    return false;
                }
                return true;
            });

            if (validItems.length > 0) {
                const promises = validItems.map(item => this.processQueueItem(item));
                await Promise.allSettled(promises);
            }

        } catch (error) {
            logger.error('Error processing queue:', error);
            this.stats.errors++;
        } finally {
            this.isProcessing = false;
        }
    }

    startMemoryCleanup() {
        setInterval(() => {
            if (this.processedTokens.size > 3000) {
                logger.info(`Clearing processed tokens cache (${this.processedTokens.size} entries)`);
                this.processedTokens.clear();
            }
        }, 5 * 60 * 1000);
        
        logger.info('Memory cleanup process started');
    }

    setupShutdownCleanup() {
        const cleanup = async () => {
            logger.info('🧹 Cleaning up TokenDeploymentMonitor...');
            try {
                await this.socialMediaManager.cleanup();
                logger.info('✅ TokenDeploymentMonitor cleanup completed');
            } catch (error) {
                logger.error('❌ Error during cleanup:', error);
            }
        };

        process.on('SIGINT', cleanup);
        process.on('SIGTERM', cleanup);
        process.on('exit', cleanup);
    }

    // Status methods
    getStatus() {
        return {
            processedTokensCount: this.processedTokens.size,
            queueLength: this.processingQueue.length,
            currentlyAnalyzing: this.currentlyAnalyzing.size,
            maxConcurrentAnalyses: this.config.maxConcurrentAnalyses,
            isProcessing: this.isProcessing,
            stats: this.stats,
            config: {
                minTwitterLikes: this.config.minTwitterLikes,
                minTwitterViews: this.config.minTwitterViews,
                enableViewCountExtraction: this.config.enableViewCountExtraction,
                analysisTimeout: this.config.analysisTimeout,
                tiktokAutoQualification: true // ✅ ADDED: Show TikTok support
            }
        };
    }

    getStatsString() {
        const { 
            tokensReceived, 
            tokensProcessed, 
            tokensAnalyzed, 
            tokensSkipped, 
            tiktokAutoQualified, 
            twitterQualified,
            socialMediaFailures, // ✅ FIXED: Consistent variable name
            viewCountsExtracted, 
            errors 
        } = this.stats;
        
        const successRate = tokensReceived > 0 ? ((tokensAnalyzed / tokensReceived) * 100).toFixed(1) : 0;
        const twitterSuccessRate = twitterQualified > 0 ? ((viewCountsExtracted / twitterQualified) * 100).toFixed(1) : 0;
        
        return `📊 Creation Stats: ${tokensReceived} received | ${tokensProcessed} processed | ${tokensAnalyzed} analyzed (🎵 ${tiktokAutoQualified} TikTok + 🐦 ${twitterQualified} Twitter) | ${tokensSkipped} skipped | Twitter views: ${viewCountsExtracted} (${twitterSuccessRate}%) | ${errors} errors | Overall: ${successRate}% success`;
    }

    resetStats() {
        this.stats = {
            tokensReceived: 0,
            tokensProcessed: 0,
            tokensSkipped: 0,
            tokensAnalyzed: 0,
            tiktokAutoQualified: 0, // ✅ ADDED: Include TikTok stats
            twitterQualified: 0,    // ✅ ADDED: Include Twitter stats
            viewCountsExtracted: 0,
            socialMediaFailures: 0, // ✅ FIXED: Consistent variable name
            errors: 0
        };
        logger.info('Statistics reset');
    }

    clearProcessedTokens() {
        if (this.processedTokens.size > 1000) {
            logger.info(`Clearing processed tokens cache (${this.processedTokens.size} entries)`);
            this.processedTokens.clear();
        }
    }
}

module.exports = TokenDeploymentMonitor;