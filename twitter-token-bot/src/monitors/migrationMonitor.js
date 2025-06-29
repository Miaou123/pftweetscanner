// src/monitors/migrationMonitor.js - CORRECTED VERSION
const EventEmitter = require('events');
const logger = require('../utils/logger');
const SocialMediaManager = require('../validators/socialMediaManager');
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
        logger.info(`   • 🎵 TikTok Auto-Qualification: Enabled`);
        logger.info(`   • View Count Extraction: ${this.config.enableViewCountExtraction ? 'Enabled' : 'Disabled'}`);

        // Use SocialMediaManager instead of TwitterValidator
        this.socialMediaManager = new SocialMediaManager({
            enableViewCountExtraction: this.config.enableViewCountExtraction,
            viewCountTimeout: this.config.viewCountTimeout,
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
        
        // Enhanced stats with TikTok tracking
        this.stats = {
            migrationsReceived: 0,
            migrationsProcessed: 0,
            analysesCompleted: 0,
            migrationsSkipped: 0,
            tiktokAutoQualified: 0,
            twitterQualified: 0,
            socialMediaValidationFailed: 0, // ✅ FIXED: Consistent naming
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

            // STEP 2: Use SocialMediaManager for social validation
            logger.info(`⏱️ [${timer.operationId}] Step 2: Social validation (TikTok/Twitter detection)...`);
            const socialValidationStart = Date.now();
            
            // Create a tokenEvent-like object for social extraction
            const tokenEventForSocial = {
                ...tokenInfo,
                website: tokenInfo.website,
                twitter: tokenInfo.twitter,
                telegram: tokenInfo.telegram,
                description: tokenInfo.description,
                uri: tokenInfo.metadata_uri
            };
            
            // Use SocialMediaManager
            const socialResult = await this.socialMediaManager.quickEngagementCheck(tokenEventForSocial);
            
            if (!socialResult) {
                const socialTime = Date.now() - socialValidationStart;
                logger.info(`❌ [${timer.operationId}] No social URL found in ${socialTime}ms, skipping`);
                this.stats.migrationsSkipped++;
                return;
            }

            const { url: socialUrl, platform, metrics: socialMetrics, autoQualified } = socialResult;
            const socialValidationTime = Date.now() - socialValidationStart;

            // 🎵 TikTok Auto-Qualification Path
            if (platform === 'tiktok') {
                logger.info(`🎵 [${timer.operationId}] TikTok link detected in ${socialValidationTime}ms: ${socialUrl}`);
                logger.info(`🚀 [${timer.operationId}] AUTO-QUALIFYING ${tokenInfo.symbol} - TikTok has viral potential!`);
                
                this.stats.tiktokAutoQualified++;
                
                // Create complete token event
                const completeTokenEvent = {
                    ...migrationEvent,
                    eventType: 'migration',
                    name: tokenInfo.name,
                    symbol: tokenInfo.symbol,
                    timer: timer,
                    tokenInfo: tokenInfo
                };

                // Add to processing queue immediately
                this.processingQueue.push({
                    tokenEvent: completeTokenEvent,
                    socialUrl,
                    socialMetrics,
                    platform: 'tiktok',
                    autoQualified: true,
                    timestamp: Date.now(),
                    eventType: 'migration',
                    timer: timer
                });

                const totalPreProcessTime = Date.now() - startTime;
                logger.info(`🎵 [${timer.operationId}] TikTok migration auto-qualified in ${totalPreProcessTime}ms (queue size: ${this.processingQueue.length})`);
                return;
            }

            // 🐦 Twitter Engagement Check Path
            if (platform === 'twitter') {
                logger.info(`📱 [${timer.operationId}] Twitter link found in ${socialValidationTime}ms: ${socialUrl}`);

                if (!socialMetrics || !socialMetrics.likes) {
                    logger.warn(`❌ [${timer.operationId}] Twitter validation failed`);
                    this.stats.socialMediaValidationFailed++; // ✅ FIXED: Consistent variable name
                    this.stats.migrationsSkipped++;
                    return;
                }

                logger.info(`✅ [${timer.operationId}] Twitter validation complete: ${socialMetrics.likes} likes`);

                // STEP 3: Check likes threshold for Twitter
                if (socialMetrics.likes < this.config.minTwitterLikes) {
                    logger.info(`❌ [${timer.operationId}] ${tokenInfo.symbol} has ${socialMetrics.likes} likes (< ${this.config.minTwitterLikes}), skipping`);
                    this.stats.likesThresholdFailed++;
                    this.stats.migrationsSkipped++;
                    return;
                }

                // 🚀 Twitter QUALIFIED! Add to processing queue
                logger.info(`🚀 [${timer.operationId}] ${tokenInfo.symbol} qualified with ${socialMetrics.likes} Twitter likes! Adding to analysis queue...`);
                this.stats.twitterQualified++;

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
                    socialUrl,
                    socialMetrics,
                    platform: 'twitter',
                    autoQualified: false,
                    timestamp: Date.now(),
                    eventType: 'migration',
                    timer: timer
                });

                const totalPreProcessTime = Date.now() - startTime;
                logger.info(`📊 [${timer.operationId}] Twitter-qualified migration added to queue in ${totalPreProcessTime}ms (queue size: ${this.processingQueue.length})`);
            }

        } catch (error) {
            const totalTime = Date.now() - startTime;
            logger.error(`❌ [${timer.operationId}] Error processing migration in ${totalTime}ms:`, error);
            this.stats.errors++;
        }
    }

    async processQueueItem(item) {
        const { tokenEvent, socialUrl, socialMetrics, platform, autoQualified, timestamp, eventType, timer } = item;
        const operationId = timer?.operationId || `${tokenEvent.symbol}_${eventType}_${Date.now()}`;
        const processingStart = Date.now();

        try {
            this.stats.migrationsProcessed++;
            const platformEmoji = platform === 'tiktok' ? '🎵' : '📱';
            const qualificationStatus = autoQualified ? 'AUTO-QUALIFIED' : 'QUALIFIED';
            
            logger.info(`🔄 [${operationId}] Processing ${qualificationStatus} migration: ${tokenEvent.symbol} (${platformEmoji} ${platform.toUpperCase()})`);

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
                
                // Promise 1: View extraction (only for Twitter, TikTok skips this)
                if (platform === 'twitter' && this.config.enableViewCountExtraction) {
                    parallelPromises.push(this.extractViewsParallel(socialUrl, operationId));
                } else if (platform === 'tiktok') {
                    logger.info(`[${operationId}] 🎵 TikTok - skipping view extraction (auto-qualified)`);
                }
                
                // Promise 2: Analysis (always runs)
                parallelPromises.push(this.runAnalysisParallel(tokenEvent, socialMetrics, operationId, timer));
                
                // Execute truly in parallel
                const results = await Promise.allSettled(parallelPromises);
                
                // Process results based on what was executed
                let viewMetrics = null;
                let analysisResult = null;
                let viewExtractionTime = 0;
                
                if (platform === 'twitter' && this.config.enableViewCountExtraction) {
                    // Views + Analysis for Twitter
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
                    // Analysis only (TikTok path or Twitter without view extraction)
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
                
                // Create final metrics
                const finalSocialMetrics = {
                    link: socialUrl,
                    platform: platform,
                    likes: socialMetrics.likes,
                    views: viewMetrics?.views || socialMetrics.views || 0,
                    retweets: 0,
                    replies: 0,
                    publishedAt: socialMetrics.publishedAt,
                    autoQualified: autoQualified,
                    qualificationReason: autoQualified ? `${platform} link detected - auto-qualified` : 'Engagement threshold met'
                };
                
                const totalProcessingTime = Date.now() - processingStart;
                
                // Publish results
                await this.publishCompletedAnalysis(tokenEvent, finalSocialMetrics, analysisResult, operationId, timer);
                
                const platformSymbol = platform === 'tiktok' ? '🎵' : '📱';
                logger.info(`✅ [${operationId}] Migration completed in ${totalProcessingTime}ms`);
                logger.info(`📊 [${operationId}] Final: ${finalSocialMetrics.views} views, ${finalSocialMetrics.likes} likes (${platformSymbol} ${platform.toUpperCase()})`);
                
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

    // Use SocialMediaManager for view extraction
    async extractViewsParallel(socialUrl, operationId) {
        const start = Date.now();
        try {
            const viewMetrics = await this.socialMediaManager.validateEngagementForPlatform(socialUrl, 'twitter');
            const duration = Date.now() - start;
            
            logger.debug(`[${operationId}] View extraction: ${viewMetrics?.views || 'failed'} (${duration}ms)`);
            return { viewMetrics, duration };
        } catch (error) {
            const duration = Date.now() - start;
            logger.warn(`⚠️ [${operationId}] View extraction error (${duration}ms): ${error.message}`);
            return { viewMetrics: null, duration };
        }
    }

    async runAnalysisParallel(tokenEvent, socialMetrics, operationId, timer) {
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
                twitterMetrics: socialMetrics, // Keep name for compatibility
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

    async publishCompletedAnalysis(tokenEvent, finalSocialMetrics, analysisResult, operationId, timer) {
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
                twitterMetrics: finalSocialMetrics, // Keep for compatibility
                socialMetrics: finalSocialMetrics,   // New field
                operationId,
                timer
            };

            await this.telegramPublisher.publishAnalysis(completeAnalysisResult);
            const platformEmoji = finalSocialMetrics.platform === 'tiktok' ? '🎵' : '📱';
            logger.info(`📤 [${operationId}] Published to Telegram (${platformEmoji} ${finalSocialMetrics.platform.toUpperCase()})`);

            this.emit('analysisCompleted', {
                tokenEvent,
                twitterMetrics: finalSocialMetrics, // Keep for compatibility
                socialMetrics: finalSocialMetrics,   // New field
                platform: finalSocialMetrics.platform,
                autoQualified: finalSocialMetrics.autoQualified,
                analysisResult,
                operationId
            });

        } catch (error) {
            logger.error(`❌ [${operationId}] Failed to publish analysis: ${error.message}`);
            this.stats.errors++;
        }
    }

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
                await this.socialMediaManager.cleanup();
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
                viewCountTimeout: this.config.viewCountTimeout,
                tiktokAutoQualification: true // ✅ ADDED: Show TikTok support
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
            tiktokAutoQualified,
            twitterQualified,
            socialMediaValidationFailed, // ✅ FIXED: Consistent variable name
            likesThresholdFailed,
            viewCountsExtracted,
            errors 
        } = this.stats;
        
        const successRate = migrationsReceived > 0 ? ((analysesCompleted / migrationsReceived) * 100).toFixed(1) : 0;
        const viewRate = twitterQualified > 0 ? ((viewCountsExtracted / twitterQualified) * 100).toFixed(1) : 0;
        
        return `📊 Migration Stats: ${migrationsReceived} received | ${analysesCompleted} analyzed (🎵 ${tiktokAutoQualified} TikTok + 📱 ${twitterQualified} Twitter) | ${migrationsSkipped} skipped (${socialMediaValidationFailed} social fails, ${likesThresholdFailed} likes fails) | ${viewCountsExtracted} views (${viewRate}%) | ${errors} errors | ${successRate}% success`;
    }

    resetStats() {
        this.stats = {
            migrationsReceived: 0,
            migrationsProcessed: 0,
            analysesCompleted: 0,
            migrationsSkipped: 0,
            tiktokAutoQualified: 0,        // ✅ ADDED: Include TikTok stats
            twitterQualified: 0,           // ✅ ADDED: Include Twitter stats
            socialMediaValidationFailed: 0, // ✅ FIXED: Consistent variable name
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
            await this.socialMediaManager.cleanup();
            logger.info('✅ MigrationMonitor cleanup completed');
        } catch (error) {
            logger.error('❌ Error during cleanup:', error);
        }
    }
}

module.exports = MigrationMonitor;