// src/monitors/migrationMonitor.js - OPTIMIZED workflow with proper TwitterValidator usage
const EventEmitter = require('events');
const logger = require('../utils/logger');
const TwitterValidator = require('../validators/twitterValidator');
const AnalysisOrchestrator = require('../orchestrators/analysisOrchestrator');
const TelegramPublisher = require('../publishers/telegramPublisher');
const pumpfunApi = require('../integrations/pumpfunApi');

class MigrationMonitor extends EventEmitter {
    constructor(config = {}) {
        super();
        
        this.config = {
            minTwitterViews: config.minTwitterViews || 50000,
            minTwitterLikes: config.minTwitterLikes || 1,
            analysisTimeout: config.analysisTimeout || 10 * 60 * 1000,
            maxConcurrentAnalyses: config.maxConcurrentAnalyses || 5,
            processingDelay: config.processingDelay || 1000,
            enableViewCountExtraction: config.enableViewCountExtraction !== false,
            viewCountTimeout: config.viewCountTimeout || 15000,
            telegram: config.telegram || {},
            ...config
        };

        logger.info(`📋 MigrationMonitor Config:`);
        logger.info(`   • Min Twitter Likes: ${this.config.minTwitterLikes.toLocaleString()}`);
        logger.info(`   • View Count Extraction: ${this.config.enableViewCountExtraction ? 'Enabled' : 'Disabled'}`);

        // 🔥 SINGLE TwitterValidator instance handles ALL Twitter operations
        this.twitterValidator = new TwitterValidator({
            enablePageExtraction: this.config.enableViewCountExtraction,
            timeout: this.config.viewCountTimeout,
            quickTimeout: 5000
        });
        
        this.analysisOrchestrator = new AnalysisOrchestrator({
            ...this.config,
            botType: 'migration',
            publishResults: false,
            saveToJson: true
        });
        
        this.telegramPublisher = new TelegramPublisher(this.config.telegram);
        
        this.processedTokens = new Set();
        this.processingQueue = [];
        this.currentlyAnalyzing = new Set();
        this.isProcessing = false;
        this.stats = {
            migrationsReceived: 0,
            migrationsProcessed: 0,
            analysesCompleted: 0,
            migrationsSkipped: 0,
            twitterValidationFailed: 0,
            likesThresholdFailed: 0,
            viewCountsExtracted: 0,
            metadataFetchFailures: 0,
            errors: 0
        };

        this.processTokenMigration = this.processTokenMigration.bind(this);
        this.processQueue = this.processQueue.bind(this);
        
        this.startQueueProcessor();
        this.startMemoryCleanup();
        this.setupShutdownCleanup();
    }

    async processTokenMigration(migrationEvent) {
        const timer = migrationEvent.timer;
        const startTime = Date.now();
        
        try {
            logger.info(`🔄 Processing token migration: ${migrationEvent.mint}`);
            this.stats.migrationsReceived++;
            
            if (this.processedTokens.has(migrationEvent.mint)) {
                logger.debug(`Migration token ${migrationEvent.mint} already processed, skipping`);
                this.stats.migrationsSkipped++;
                return;
            }

            this.processedTokens.add(migrationEvent.mint);

            // STEP 1: Fetch token metadata
            logger.info(`⏱️ [${timer.operationId}] Step 1: Fetching token metadata...`);
            const metadataStart = Date.now();
            
            let tokenInfo;
            try {
                tokenInfo = await pumpfunApi.getTokenInfo(migrationEvent.mint);
                const metadataTime = Date.now() - metadataStart;
                logger.info(`✅ [${timer.operationId}] Metadata fetched in ${metadataTime}ms`);
            } catch (error) {
                const metadataTime = Date.now() - metadataStart;
                logger.warn(`❌ [${timer.operationId}] Metadata fetch failed in ${metadataTime}ms: ${error.message}`);
                this.stats.metadataFetchFailures++;
                this.stats.migrationsSkipped++;
                return;
            }

            if (!tokenInfo) {
                logger.warn(`No token info found for migration ${migrationEvent.mint}, skipping`);
                this.stats.metadataFetchFailures++;
                this.stats.migrationsSkipped++;
                return;
            }

            logger.info(`✅ Token metadata: ${tokenInfo.name} (${tokenInfo.symbol})`);

            // 🔥 STEP 2: Use TwitterValidator to extract URL and check likes in ONE operation
            logger.info(`⏱️ [${timer.operationId}] Step 2: Twitter validation (URL extraction + likes check)...`);
            const twitterValidationStart = Date.now();
            
            // Create a tokenEvent-like object for TwitterValidator
            const tokenEventForTwitter = {
                ...tokenInfo,
                twitter: tokenInfo.twitter,
                website: tokenInfo.website,
                telegram: tokenInfo.telegram,
                description: tokenInfo.description,
                uri: tokenInfo.metadata_uri
            };
            
            // 🔥 OPTIMIZED: TwitterValidator handles URL extraction AND likes check
            const twitterUrl = await this.twitterValidator.extractTwitterUrl(tokenEventForTwitter);
            
            if (!twitterUrl) {
                const twitterTime = Date.now() - twitterValidationStart;
                logger.info(`❌ [${timer.operationId}] No Twitter URL found in ${twitterTime}ms, skipping`);
                this.stats.migrationsSkipped++;
                return;
            }

            // Immediate likes check
            const quickMetrics = await this.twitterValidator.quickLikesCheck(twitterUrl);
            const twitterValidationTime = Date.now() - twitterValidationStart;

            if (!quickMetrics || !quickMetrics.likes) {
                logger.warn(`❌ [${timer.operationId}] Twitter validation failed in ${twitterValidationTime}ms`);
                this.stats.twitterValidationFailed++;
                this.stats.migrationsSkipped++;
                return;
            }

            logger.info(`✅ [${timer.operationId}] Twitter validation complete in ${twitterValidationTime}ms: ${quickMetrics.likes} likes`);

            // STEP 3: Check likes threshold
            if (quickMetrics.likes < this.config.minTwitterLikes) {
                logger.info(`❌ [${timer.operationId}] ${tokenInfo.symbol} has ${quickMetrics.likes} likes (< ${this.config.minTwitterLikes}), skipping`);
                this.stats.likesThresholdFailed++;
                this.stats.migrationsSkipped++;
                return;
            }

            // 🚀 QUALIFIED! Add to processing queue
            logger.info(`🚀 [${timer.operationId}] ${tokenInfo.symbol} QUALIFIED with ${quickMetrics.likes} likes! Adding to analysis queue...`);

            const completeTokenEvent = {
                ...migrationEvent,
                eventType: 'migration',
                name: tokenInfo.name,
                symbol: tokenInfo.symbol,
                timer: timer,
                tokenInfo: tokenInfo
            };

            this.processingQueue.push({
                tokenEvent: completeTokenEvent,
                twitterUrl,
                quickMetrics,
                timestamp: Date.now(),
                eventType: 'migration',
                timer: timer
            });

            const totalPreProcessTime = Date.now() - startTime;
            logger.info(`📊 [${timer.operationId}] Qualified migration added to queue in ${totalPreProcessTime}ms (queue size: ${this.processingQueue.length})`);

        } catch (error) {
            const totalTime = Date.now() - startTime;
            logger.error(`❌ [${timer.operationId}] Error processing migration in ${totalTime}ms:`, error);
            this.stats.errors++;
        }
    }

    async processQueueItem(item) {
        const { tokenEvent, twitterUrl, quickMetrics, timestamp, eventType, timer } = item;
        const operationId = timer?.operationId || `${tokenEvent.symbol}_${eventType}_${Date.now()}`;
        const processingStart = Date.now();

        try {
            this.stats.migrationsProcessed++;
            logger.info(`🔄 [${operationId}] Processing QUALIFIED migration: ${tokenEvent.symbol} (${quickMetrics.likes} likes)`);

            // Check if item is too old
            const queueAge = Date.now() - timestamp;
            if (queueAge > 15 * 60 * 1000) {
                logger.warn(`[${operationId}] Migration too old (${Math.round(queueAge/1000)}s), skipping`);
                this.stats.migrationsSkipped++;
                return;
            }

            // Check concurrent limit
            if (this.currentlyAnalyzing.size >= this.config.maxConcurrentAnalyses) {
                logger.warn(`[${operationId}] Max concurrent analyses reached, requeuing`);
                setTimeout(() => this.processingQueue.unshift(item), 30000);
                return;
            }

            this.currentlyAnalyzing.add(tokenEvent.mint);

            try {
                // 🚀 OPTIMIZED PARALLEL EXECUTION: Views + Analysis
                logger.info(`⚡ [${operationId}] Running parallel operations...`);
                
                const parallelPromises = [];
                
                // Promise 1: View extraction (if enabled) using TwitterValidator
                if (this.config.enableViewCountExtraction) {
                    parallelPromises.push(this.extractViewsParallel(twitterUrl, operationId));
                }
                
                // Promise 2: Analysis (always runs)
                parallelPromises.push(this.runAnalysisParallel(tokenEvent, quickMetrics, operationId, timer));
                
                // Execute truly in parallel
                const results = await Promise.allSettled(parallelPromises);
                
                // Process results based on what was executed
                let viewMetrics = null;
                let analysisResult = null;
                let viewExtractionTime = 0;
                
                if (this.config.enableViewCountExtraction) {
                    // Views + Analysis
                    const viewResult = results[0];
                    const analysisResultData = results[1];
                    
                    if (viewResult.status === 'fulfilled') {
                        viewMetrics = viewResult.value.viewMetrics;
                        viewExtractionTime = viewResult.value.duration;
                        if (viewMetrics?.views > 0) this.stats.viewCountsExtracted++;
                    }
                    
                    if (analysisResultData.status === 'fulfilled') {
                        analysisResult = analysisResultData.value.analysisResult;
                    }
                } else {
                    // Analysis only
                    const analysisResultData = results[0];
                    if (analysisResultData.status === 'fulfilled') {
                        analysisResult = analysisResultData.value.analysisResult;
                    }
                }

                if (!analysisResult || !analysisResult.success) {
                    logger.error(`❌ [${operationId}] Analysis failed`);
                    this.stats.errors++;
                    return;
                }
                
                // 🔥 OPTIMIZED: Create final metrics
                const finalTwitterMetrics = {
                    link: twitterUrl,
                    likes: quickMetrics.likes,
                    views: viewMetrics?.views || 0,
                    retweets: 0,
                    replies: 0,
                    publishedAt: quickMetrics.publishedAt
                };
                
                const totalProcessingTime = Date.now() - processingStart;
                
                // Publish results
                await this.publishCompletedAnalysis(tokenEvent, finalTwitterMetrics, analysisResult, operationId, timer);
                
                logger.info(`✅ [${operationId}] Migration completed in ${totalProcessingTime}ms`);
                logger.info(`📊 [${operationId}] Final: ${finalTwitterMetrics.views} views, ${finalTwitterMetrics.likes} likes`);
                
                this.stats.analysesCompleted++;

            } finally {
                this.currentlyAnalyzing.delete(tokenEvent.mint);
            }

        } catch (error) {
            const processingTime = Date.now() - processingStart;
            logger.error(`❌ [${operationId}] Error processing migration in ${processingTime}ms:`, error);
            this.stats.errors++;
        }
    }

    // 🔥 OPTIMIZED: Use TwitterValidator directly for views
    async extractViewsParallel(twitterUrl, operationId) {
        const start = Date.now();
        try {
            const tweetId = this.twitterValidator.extractTweetId(twitterUrl);
            const viewMetrics = await this.twitterValidator.getViewsFromPage(tweetId);
            const duration = Date.now() - start;
            
            logger.debug(`[${operationId}] View extraction: ${viewMetrics?.views || 'failed'} (${duration}ms)`);
            return { viewMetrics, duration };
        } catch (error) {
            const duration = Date.now() - start;
            logger.warn(`⚠️ [${operationId}] View extraction error (${duration}ms): ${error.message}`);
            return { viewMetrics: null, duration };
        }
    }

    async runAnalysisParallel(tokenEvent, quickMetrics, operationId, timer) {
        const start = Date.now();
        try {
            const analysisResult = await this.analysisOrchestrator.analyzeToken({
                tokenAddress: tokenEvent.mint,
                tokenInfo: {
                    name: tokenEvent.name,
                    symbol: tokenEvent.symbol,
                    creator: tokenEvent.traderPublicKey || tokenEvent.creator,
                    address: tokenEvent.mint,
                    eventType: 'migration'
                },
                twitterMetrics: quickMetrics,
                operationId,
                timer
            });
            
            const duration = Date.now() - start;
            logger.debug(`[${operationId}] Analysis: ${analysisResult.success ? 'success' : 'failed'} (${duration}ms)`);
            return { analysisResult, duration };
        } catch (error) {
            const duration = Date.now() - start;
            logger.error(`❌ [${operationId}] Analysis error (${duration}ms): ${error.message}`);
            throw error;
        }
    }

    async publishCompletedAnalysis(tokenEvent, finalTwitterMetrics, analysisResult, operationId, timer) {
        try {
            const completeAnalysisResult = {
                ...analysisResult,
                tokenInfo: {
                    name: tokenEvent.name,
                    symbol: tokenEvent.symbol,
                    creator: tokenEvent.traderPublicKey || tokenEvent.creator,
                    address: tokenEvent.mint,
                    eventType: 'migration'
                },
                twitterMetrics: finalTwitterMetrics,
                operationId,
                timer
            };

            await this.telegramPublisher.publishAnalysis(completeAnalysisResult);
            logger.info(`📤 [${operationId}] Published to Telegram`);

            this.emit('analysisCompleted', {
                tokenEvent,
                twitterMetrics: finalTwitterMetrics,
                analysisResult,
                operationId
            });

        } catch (error) {
            logger.error(`❌ [${operationId}] Failed to publish analysis: ${error.message}`);
            this.stats.errors++;
        }
    }

    // 🔥 REMOVED: All duplicate Twitter URL extraction methods
    // TwitterValidator now handles everything

    startQueueProcessor() {
        setInterval(async () => {
            if (!this.isProcessing && this.processingQueue.length > 0) {
                await this.processQueue();
            }
        }, this.config.processingDelay);

        logger.info(`Migration queue processor started with ${this.config.processingDelay}ms interval`);
    }

    startMemoryCleanup() {
        setInterval(() => {
            this.clearProcessedTokens();
        }, 10 * 60 * 1000);
        logger.info('Migration memory cleanup process started');
    }

    async processQueue() {
        if (this.isProcessing || this.processingQueue.length === 0) {
            return;
        }

        this.isProcessing = true;

        try {
            const batchSize = Math.min(3, this.processingQueue.length);
            const batch = this.processingQueue.splice(0, batchSize);

            logger.info(`Processing migration batch of ${batch.length} items`);

            const promises = batch.map(item => this.processQueueItem(item));
            await Promise.allSettled(promises);

        } catch (error) {
            logger.error('Error processing migration queue:', error);
            this.stats.errors++;
        } finally {
            this.isProcessing = false;
        }
    }

    setupShutdownCleanup() {
        const cleanup = async () => {
            logger.info('🧹 Cleaning up MigrationMonitor resources...');
            try {
                await this.twitterValidator.cleanup();
                logger.info('✅ MigrationMonitor cleanup completed');
            } catch (error) {
                logger.error('❌ Error during cleanup:', error);
            }
        };

        process.on('SIGINT', cleanup);
        process.on('SIGTERM', cleanup);
        process.on('exit', cleanup);
    }

    getStatus() {
        return {
            botType: 'migration',
            processedTokensCount: this.processedTokens.size,
            queueLength: this.processingQueue.length,
            currentlyAnalyzing: this.currentlyAnalyzing.size,
            maxConcurrentAnalyses: this.config.maxConcurrentAnalyses,
            isProcessing: this.isProcessing,
            stats: this.stats,
            config: {
                minTwitterLikes: this.config.minTwitterLikes,
                enableViewCountExtraction: this.config.enableViewCountExtraction,
                viewCountTimeout: this.config.viewCountTimeout
            }
        };
    }

    clearProcessedTokens() {
        if (this.processedTokens.size > 1000) {
            logger.info(`Clearing processed migrations cache (${this.processedTokens.size} entries)`);
            this.processedTokens.clear();
        }
    }

    getStatsString() {
        const { 
            migrationsReceived, 
            migrationsProcessed, 
            analysesCompleted, 
            migrationsSkipped, 
            twitterValidationFailed,
            likesThresholdFailed,
            viewCountsExtracted,
            errors 
        } = this.stats;
        
        const successRate = migrationsReceived > 0 ? ((analysesCompleted / migrationsReceived) * 100).toFixed(1) : 0;
        const viewRate = analysesCompleted > 0 ? ((viewCountsExtracted / analysesCompleted) * 100).toFixed(1) : 0;
        
        return `📊 Migration Stats: ${migrationsReceived} received | ${analysesCompleted} analyzed | ${migrationsSkipped} skipped (${twitterValidationFailed} Twitter fails, ${likesThresholdFailed} likes fails) | ${viewCountsExtracted} views (${viewRate}%) | ${errors} errors | ${successRate}% success`;
    }

    resetStats() {
        this.stats = {
            migrationsReceived: 0,
            migrationsProcessed: 0,
            analysesCompleted: 0,
            migrationsSkipped: 0,
            twitterValidationFailed: 0,
            likesThresholdFailed: 0,
            viewCountsExtracted: 0,
            metadataFetchFailures: 0,
            errors: 0
        };
        logger.info('Migration statistics reset');
    }

    async cleanup() {
        logger.info('🧹 Cleaning up MigrationMonitor...');
        try {
            await this.twitterValidator.cleanup();
            logger.info('✅ MigrationMonitor cleanup completed');
        } catch (error) {
            logger.error('❌ Error during cleanup:', error);
        }
    }
}

module.exports = MigrationMonitor;