// src/monitors/tokenDeploymentMonitor.js - Streamlined using TwitterValidator
const EventEmitter = require('events');
const logger = require('../utils/logger');
const TwitterValidator = require('../validators/twitterValidator');
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
        logger.info(`   • View Count Extraction: ${this.config.enableViewCountExtraction ? 'Enabled' : 'Disabled'}`);

        // Single TwitterValidator instance
        this.twitterValidator = new TwitterValidator({
            enablePageExtraction: this.config.enableViewCountExtraction,
            timeout: this.config.viewCountTimeout,
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
        
        // Performance stats
        this.stats = {
            tokensReceived: 0,
            tokensProcessed: 0,
            tokensSkipped: 0,
            tokensAnalyzed: 0,
            viewCountsExtracted: 0,
            twitterFailures: 0,
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

            // Extract Twitter URL using TwitterValidator
            const twitterUrl = await this.twitterValidator.extractTwitterUrl(tokenEvent);

            if (!twitterUrl) {
                logger.debug(`No valid tweet status URL found for ${tokenEvent.symbol}`);
                this.stats.tokensSkipped++;
                return;
            }

            logger.info(`📱 Valid tweet found for ${tokenEvent.symbol}: ${twitterUrl}`);

            // Add to processing queue
            this.processingQueue.push({
                tokenEvent,
                twitterUrl,
                timestamp: Date.now(),
                timer
            });

            this.stats.tokensProcessed++;
            logger.debug(`Queued ${tokenEvent.symbol}. Queue size: ${this.processingQueue.length}`);

        } catch (error) {
            logger.error(`Error processing new token ${tokenEvent.mint}:`, error);
            this.stats.errors++;
        }
    }

    async processQueueItem(item) {
        const { tokenEvent, twitterUrl, timestamp, timer } = item;
        const operationId = timer.operationId;

        try {
            logger.info(`🔄 [${operationId}] Processing: ${tokenEvent.symbol}`);

            // Check if item is too old (10 minutes)
            if (Date.now() - timestamp > 10 * 60 * 1000) {
                logger.warn(`[${operationId}] Item too old, skipping: ${tokenEvent.symbol}`);
                this.stats.tokensSkipped++;
                return;
            }

            // STEP 1: Quick likes check
            logger.debug(`[${operationId}] 🚀 Quick likes check: ${twitterUrl}`);
            const quickMetrics = await this.twitterValidator.quickLikesCheck(twitterUrl);

            if (!quickMetrics || !quickMetrics.likes) {
                logger.info(`[${operationId}] Twitter validation failed for ${tokenEvent.symbol}`);
                this.stats.twitterFailures++;
                return;
            }

            logger.info(`[${operationId}] ⚡ ${quickMetrics.likes} likes found`);

            // STEP 2: Check engagement threshold
            if (quickMetrics.likes < this.config.minTwitterLikes) {
                logger.info(`[${operationId}] ${tokenEvent.symbol} has ${quickMetrics.likes} likes (< ${this.config.minTwitterLikes}), skipping`);
                this.stats.tokensSkipped++;
                return;
            }

            // STEP 3: QUALIFIED! Run expensive operations
            logger.info(`🚀 [${operationId}] ${tokenEvent.symbol} qualified with ${quickMetrics.likes} likes! Starting analysis...`);
            await this.runQualifiedAnalysis(tokenEvent, twitterUrl, quickMetrics, operationId, timer);

        } catch (error) {
            logger.error(`[${operationId}] Error processing queue item:`, error);
            this.stats.errors++;
        }
    }

    async runQualifiedAnalysis(tokenEvent, twitterUrl, quickMetrics, operationId, timer) {
        // Check concurrent limit
        if (this.currentlyAnalyzing.size >= this.config.maxConcurrentAnalyses) {
            logger.warn(`[${operationId}] Max concurrent analyses reached, requeuing`);
            setTimeout(() => {
                this.processingQueue.unshift({ 
                    tokenEvent, 
                    twitterUrl, 
                    timestamp: Date.now(),
                    timer 
                });
            }, 30000);
            return;
        }

        this.currentlyAnalyzing.add(tokenEvent.mint);

        try {
            let finalTwitterMetrics = quickMetrics;

            // Get full metrics including views if enabled
            if (this.config.enableViewCountExtraction) {
                logger.info(`[${operationId}] 📊 Extracting view count...`);
                try {
                    const viewStart = Date.now();
                    const fullMetrics = await this.twitterValidator.validateEngagement(twitterUrl);
                    const viewTime = Date.now() - viewStart;
                    
                    if (fullMetrics && (fullMetrics.views > 0 || fullMetrics.likes > quickMetrics.likes)) {
                        finalTwitterMetrics = fullMetrics;
                        this.stats.viewCountsExtracted++;
                        logger.info(`[${operationId}] ✅ Views extracted (${viewTime}ms): ${finalTwitterMetrics.views} views, ${finalTwitterMetrics.likes} likes`);
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
                twitterMetrics: finalTwitterMetrics,
                operationId,
                timer
            });
            
            const analysisTime = Date.now() - analysisStart;

            // Handle result
            if (analysisResult.success) {
                logger.info(`✅ [${operationId}] Analysis completed (${analysisTime}ms)`);
                this.stats.tokensAnalyzed++;
                
                this.emit('analysisCompleted', {
                    tokenEvent,
                    twitterMetrics: finalTwitterMetrics,
                    analysisResult,
                    operationId
                });
            } else {
                logger.error(`❌ [${operationId}] Analysis failed: ${analysisResult.error}`);
                this.stats.errors++;
            }

        } catch (error) {
            logger.error(`[${operationId}] Analysis error:`, error);
            this.stats.errors++;
        } finally {
            this.currentlyAnalyzing.delete(tokenEvent.mint);
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
                await this.twitterValidator.cleanup();
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
                analysisTimeout: this.config.analysisTimeout
            }
        };
    }

    getStatsString() {
        const { tokensReceived, tokensProcessed, tokensAnalyzed, tokensSkipped, twitterFailures, viewCountsExtracted, errors } = this.stats;
        const successRate = tokensReceived > 0 ? ((tokensAnalyzed / tokensReceived) * 100).toFixed(1) : 0;
        const twitterSuccessRate = tokensProcessed > 0 ? (((tokensProcessed - twitterFailures) / tokensProcessed) * 100).toFixed(1) : 0;
        const viewExtractionRate = tokensAnalyzed > 0 ? ((viewCountsExtracted / tokensAnalyzed) * 100).toFixed(1) : 0;
        
        return `📊 Creation Stats: ${tokensReceived} received | ${tokensProcessed} processed | ${tokensAnalyzed} analyzed | ${tokensSkipped} skipped | Twitter: ${twitterSuccessRate}% success | Views: ${viewCountsExtracted} (${viewExtractionRate}%) | ${errors} errors | Overall: ${successRate}% success`;
    }

    resetStats() {
        this.stats = {
            tokensReceived: 0,
            tokensProcessed: 0,
            tokensSkipped: 0,
            tokensAnalyzed: 0,
            viewCountsExtracted: 0,
            twitterFailures: 0,
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