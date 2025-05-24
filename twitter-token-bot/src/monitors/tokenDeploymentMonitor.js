// src/monitors/tokenDeploymentMonitor.js - Resource optimized version
const EventEmitter = require('events');
const axios = require('axios');
const logger = require('../utils/logger');
const TwitterValidator = require('../validators/twitterValidator');
const AnalysisOrchestrator = require('../orchestrators/analysisOrchestrator');
const { getSolanaApi } = require('../integrations/solanaApi');
const browserPool = require('../services/browserPoolManager');

class TokenDeploymentMonitor extends EventEmitter {
    constructor(config = {}) {
        super();
        
        this.config = {
            minTwitterViews: parseInt(process.env.MIN_TWITTER_VIEWS) || config.minTwitterViews || 100000,
            minTwitterLikes: parseInt(process.env.MIN_TWITTER_LIKES) || config.minTwitterLikes || 1,
            minMigrationTwitterViews: parseInt(process.env.MIN_MIGRATION_TWITTER_VIEWS) || config.minMigrationTwitterViews || 50000,
            minMigrationTwitterLikes: parseInt(process.env.MIN_MIGRATION_TWITTER_LIKES) || config.minMigrationTwitterLikes || 1,
            analysisTimeout: parseInt(process.env.ANALYSIS_TIMEOUT) || config.analysisTimeout || 5 * 60 * 1000,
            maxConcurrentAnalyses: parseInt(process.env.MAX_CONCURRENT_ANALYSES) || config.maxConcurrentAnalyses || 3,
            processingDelay: parseInt(process.env.PROCESSING_DELAY) || config.processingDelay || 2000,
            retryAttempts: config.retryAttempts || 3,
            enableViewCountExtraction: config.enableViewCountExtraction !== false,
            viewCountTimeout: config.viewCountTimeout || 15000, // 15 seconds for view extraction
            ...config
        };

        logger.info(`📋 TokenDeploymentMonitor Config:`);
        logger.info(`   • Min Twitter Views (Creation): ${this.config.minTwitterViews.toLocaleString()}`);
        logger.info(`   • Min Twitter Likes (Creation): ${this.config.minTwitterLikes.toLocaleString()}`);
        logger.info(`   • View Count Extraction: ${this.config.enableViewCountExtraction ? 'Enabled' : 'Disabled'}`);

        // Initialize validators - reuse instances for efficiency
        this.quickValidator = new TwitterValidator({
            enablePageExtraction: false,
            timeout: 5000 // Fast validation for filtering
        });
        
        this.fullValidator = new TwitterValidator({
            enablePageExtraction: true,
            timeout: this.config.viewCountTimeout // Slower but gets views
        });
        
        this.analysisOrchestrator = new AnalysisOrchestrator(this.config);
        this.solanaApi = getSolanaApi();
        
        this.processedTokens = new Set();
        this.processingQueue = [];
        this.currentlyAnalyzing = new Set();
        this.isProcessing = false;
        this.stats = {
            tokensProcessed: 0,
            migrationsProcessed: 0,
            tokensAnalyzed: 0,
            tokensSkipped: 0,
            viewCountsExtracted: 0,
            errors: 0
        };

        this.processNewToken = this.processNewToken.bind(this);
        this.processTokenMigration = this.processTokenMigration.bind(this);
        this.processQueue = this.processQueue.bind(this);
        
        this.startQueueProcessor();
        this.startMemoryCleanup();

        // Setup cleanup on shutdown
        this.setupShutdownCleanup();
    }

    setupShutdownCleanup() {
        const cleanup = async () => {
            logger.info('🧹 Cleaning up TokenDeploymentMonitor resources...');
            try {
                await this.quickValidator.cleanup();
                await this.fullValidator.cleanup();
                await browserPool.cleanup(); // Cleanup browser pool
                logger.info('✅ TokenDeploymentMonitor cleanup completed');
            } catch (error) {
                logger.error('❌ Error during cleanup:', error);
            }
        };

        process.on('SIGINT', cleanup);
        process.on('SIGTERM', cleanup);
        process.on('exit', cleanup);
    }

    async processNewToken(tokenEvent) {
        const timer = tokenEvent.timer;
        
        try {
            logger.info(`🔍 Processing new token: ${tokenEvent.name} (${tokenEvent.symbol}) - ${tokenEvent.mint}`);
            this.stats.tokensProcessed++;
            
            if (!this.validateTokenEvent(tokenEvent)) {
                logger.warn(`Invalid token event structure for ${tokenEvent.mint}`);
                this.stats.tokensSkipped++;
                return;
            }

            if (this.processedTokens.has(tokenEvent.mint)) {
                logger.debug(`Token ${tokenEvent.mint} already processed, skipping`);
                this.stats.tokensSkipped++;
                return;
            }

            this.processedTokens.add(tokenEvent.mint);

            const twitterLink = await this.extractTwitterLink(tokenEvent);

            if (!twitterLink) {
                logger.debug(`No Twitter link found for ${tokenEvent.symbol} (${tokenEvent.mint})`);
                this.stats.tokensSkipped++;
                return;
            }

            logger.info(`📱 Twitter link found for ${tokenEvent.symbol}: ${twitterLink}`);

            this.processingQueue.push({
                tokenEvent,
                twitterLink,
                timestamp: Date.now(),
                eventType: 'creation',
                timer
            });

            logger.debug(`Added ${tokenEvent.symbol} to processing queue. Queue size: ${this.processingQueue.length}`);

        } catch (error) {
            logger.error(`Error processing new token ${tokenEvent.mint}:`, error);
            this.stats.errors++;
        }
    }

    async processTokenMigration(migrationEvent) {
        const timer = migrationEvent.timer;
        
        try {
            logger.info(`🔄 Processing token migration: ${migrationEvent.mint}`);
            this.stats.migrationsProcessed++;
            
            let tokenInfo = {
                mint: migrationEvent.mint,
                name: migrationEvent.name,
                symbol: migrationEvent.symbol,
                uri: migrationEvent.uri
            };

            if (!tokenInfo.name || !tokenInfo.symbol) {
                logger.info(`Fetching token metadata for migration: ${migrationEvent.mint}`);
                try {
                    const solanaTokenData = await this.solanaApi.getAsset(migrationEvent.mint);
                    if (solanaTokenData) {
                        tokenInfo.name = solanaTokenData.name;
                        tokenInfo.symbol = solanaTokenData.symbol;
                        logger.info(`Retrieved token info: ${tokenInfo.name} (${tokenInfo.symbol})`);
                    }
                } catch (error) {
                    logger.warn(`Failed to fetch Solana metadata for ${migrationEvent.mint}:`, error.message);
                }
            }

            if (!tokenInfo.name || !tokenInfo.symbol) {
                logger.warn(`Could not retrieve token metadata for migration ${migrationEvent.mint}, skipping`);
                this.stats.tokensSkipped++;
                return;
            }

            const tokenEvent = {
                ...migrationEvent,
                eventType: 'migration',
                name: tokenInfo.name,
                symbol: tokenInfo.symbol,
                uri: tokenInfo.uri,
                timer: timer
            };

            if (this.processedTokens.has(tokenEvent.mint)) {
                logger.debug(`Migration token ${tokenEvent.mint} already processed, skipping`);
                this.stats.tokensSkipped++;
                return;
            }

            this.processedTokens.add(tokenEvent.mint);

            const twitterLink = await this.extractTwitterLink(tokenEvent);

            if (!twitterLink) {
                logger.debug(`No Twitter link found for migration ${tokenEvent.symbol} (${tokenEvent.mint})`);
                this.stats.tokensSkipped++;
                return;
            }

            logger.info(`📱 Twitter link found for migration ${tokenEvent.symbol}: ${twitterLink}`);

            this.processingQueue.push({
                tokenEvent,
                twitterLink,
                timestamp: Date.now(),
                eventType: 'migration',
                timer
            });

            logger.debug(`Added migration ${tokenEvent.symbol} to processing queue. Queue size: ${this.processingQueue.length}`);

        } catch (error) {
            logger.error(`Error processing token migration ${migrationEvent.mint}:`, error);
            this.stats.errors++;
        }
    }

    async processQueueItem(item) {
        const { tokenEvent, twitterLink, timestamp, eventType, timer } = item;
        const operationId = timer.operationId;
    
        try {
            logger.info(`🔄 [${operationId}] Processing queued ${eventType}: ${tokenEvent.symbol}`);
    
            if (Date.now() - timestamp > 10 * 60 * 1000) {
                logger.warn(`[${operationId}] Item too old, skipping: ${tokenEvent.symbol}`);
                this.stats.tokensSkipped++;
                return;
            }
    
            // STEP 1: Quick likes check (fast ~100-200ms)
            logger.debug(`[${operationId}] 🚀 Running quick likes check...`);
            const quickMetrics = await this.quickValidator.quickLikesCheck(twitterLink);
    
            if (!quickMetrics) {
                logger.info(`[${operationId}] Failed to get quick Twitter metrics for ${tokenEvent.symbol}`);
                this.stats.tokensSkipped++;
                return;
            }
    
            logger.info(`[${operationId}] ⚡ Quick check: ${quickMetrics.likes} likes`);
    
            // STEP 2: Check if meets threshold using quick likes
            const minViews = eventType === 'migration' ? this.config.minMigrationTwitterViews : this.config.minTwitterViews;
            const minLikes = eventType === 'migration' ? this.config.minMigrationTwitterLikes : this.config.minTwitterLikes;
    
            if (quickMetrics.likes < minLikes) {
                logger.info(`[${operationId}] ${tokenEvent.symbol} (${eventType}) has ${quickMetrics.likes} likes (< ${minLikes}), skipping analysis`);
                this.stats.tokensSkipped++;
                return;
            }
    
            logger.info(`🚀 [${operationId}] ${tokenEvent.symbol} (${eventType}) qualifies with ${quickMetrics.likes} likes! Starting parallel analysis...`);
            
            // STEP 3: Run 3 things in parallel - view checker + analysis
            await this.triggerParallelAnalysis(tokenEvent, twitterLink, quickMetrics, operationId, timer, eventType);
    
        } catch (error) {
            logger.error(`[${operationId}] Error processing queue item:`, error);
            this.stats.errors++;
        }
    }
    
    async triggerParallelAnalysis(tokenEvent, twitterLink, quickMetrics, operationId, timer, eventType) {
        if (this.currentlyAnalyzing.size >= this.config.maxConcurrentAnalyses) {
            logger.warn(`[${operationId}] Maximum concurrent analyses reached, queuing for later`);
            setTimeout(() => {
                this.processingQueue.unshift({ 
                    tokenEvent, 
                    twitterLink: twitterLink, 
                    timestamp: Date.now(),
                    eventType: eventType,
                    timer: timer
                });
            }, 30000);
            return;
        }
    
        this.currentlyAnalyzing.add(tokenEvent.mint);
    
        try {
            logger.info(`🔄 [${operationId}] Starting parallel execution: View Checker + Analysis`);
            
            // Run 2 operations in parallel:
            // 1. Full Twitter engagement (with views) - if enabled
            // 2. Standard analysis orchestrator (bundle + top holders)
            const parallelPromises = [
                // Standard analysis orchestrator (bundle + top holders)
                this.analysisOrchestrator.analyzeToken({
                    tokenAddress: tokenEvent.mint,
                    tokenInfo: {
                        name: tokenEvent.name,
                        symbol: tokenEvent.symbol,
                        creator: tokenEvent.traderPublicKey || tokenEvent.creator,
                        address: tokenEvent.mint,
                        eventType: eventType
                    },
                    twitterMetrics: quickMetrics, // Use quick metrics for now
                    operationId,
                    timer: timer
                })
            ];

            // Add view checker if enabled
            if (this.config.enableViewCountExtraction) {
                parallelPromises.push(this.runTwitterViewChecker(twitterLink, quickMetrics, operationId));
            }
    
            logger.debug(`[${operationId}] ⏳ Waiting for ${parallelPromises.length} parallel operations to complete...`);
            const results = await Promise.allSettled(parallelPromises);
            
            // Extract results
            const analysisResult = results[0];
            const fullTwitterMetrics = this.config.enableViewCountExtraction ? results[1] : null;
    
            // Process Twitter metrics
            let finalTwitterMetrics = quickMetrics; // Default to quick metrics
            
            if (fullTwitterMetrics && fullTwitterMetrics.status === 'fulfilled' && fullTwitterMetrics.value) {
                // Merge quick likes with full metrics (views + updated data)
                finalTwitterMetrics = {
                    ...quickMetrics,
                    ...fullTwitterMetrics.value,
                    // Ensure we keep the higher likes count
                    likes: Math.max(quickMetrics.likes, fullTwitterMetrics.value.likes || 0)
                };
                this.stats.viewCountsExtracted++;
                logger.info(`[${operationId}] 📊 Full Twitter metrics: ${finalTwitterMetrics.views || 0} views, ${finalTwitterMetrics.likes} likes`);
            } else {
                if (this.config.enableViewCountExtraction) {
                    logger.warn(`[${operationId}] ⚠️ View checker failed, using quick metrics only`);
                }
                logger.info(`[${operationId}] 📊 Quick Twitter metrics: ${finalTwitterMetrics.likes} likes`);
            }
    
            // Handle analysis result
            if (analysisResult.status === 'fulfilled' && analysisResult.value.success) {
                // Update the analysis result with final Twitter metrics
                const finalAnalysisResult = {
                    ...analysisResult.value,
                    twitterMetrics: finalTwitterMetrics // Use the merged metrics
                };
    
                logger.info(`✅ [${operationId}] Parallel analysis completed successfully for ${tokenEvent.symbol}`);
                this.stats.tokensAnalyzed++;
                
                this.emit('analysisCompleted', {
                    tokenEvent,
                    twitterMetrics: finalTwitterMetrics,
                    analysisResult: finalAnalysisResult,
                    operationId
                });
            } else {
                const error = analysisResult.status === 'fulfilled' ? 
                    analysisResult.value.error : analysisResult.reason.message;
                logger.error(`❌ [${operationId}] Analysis failed for ${tokenEvent.symbol}:`, error);
                this.stats.errors++;
            }
    
        } catch (error) {
            logger.error(`[${operationId}] Parallel analysis orchestration error:`, error);
            this.stats.errors++;
        } finally {
            this.currentlyAnalyzing.delete(tokenEvent.mint);
        }
    }
    
    async runTwitterViewChecker(twitterLink, quickMetrics, operationId) {
        try {
            logger.debug(`[${operationId}] 🔍 Starting view checker in parallel...`);
            const startTime = Date.now();
            
            // Use the reusable fullValidator instance (with puppeteer)
            const fullMetrics = await this.fullValidator.validateEngagement(twitterLink);
            
            const duration = Date.now() - startTime;
            logger.debug(`[${operationId}] 📊 View checker completed in ${duration}ms: V:${fullMetrics?.views || 0} L:${fullMetrics?.likes || 0}`);
            
            return fullMetrics;
        } catch (error) {
            logger.warn(`[${operationId}] View checker failed:`, error.message);
            return null;
        }
    }

    // All your existing utility methods remain the same...
    validateTokenEvent(tokenEvent) {
        const requiredFields = ['mint'];
        return requiredFields.every(field => 
            tokenEvent[field] && typeof tokenEvent[field] === 'string' && tokenEvent[field].trim().length > 0
        );
    }

    async extractTwitterLink(tokenEvent) {
        const possibleFields = ['twitter', 'social', 'socials'];
    
        for (const field of possibleFields) {
            if (tokenEvent[field]) {
                const twitterLink = this.findTwitterUrl(tokenEvent[field]);
                if (twitterLink) {
                    return twitterLink;
                }
            }
        }
    
        if (tokenEvent.uri) {
            const result = await this.extractTwitterFromUri(tokenEvent.uri);
            if (result) {
                return result;
            }
        }
    
        return null;
    }

    async extractTwitterFromUri(uri) {
        try {
            let fetchUrl = uri;
            if (uri.startsWith('ipfs://')) {
                fetchUrl = uri.replace('ipfs://', 'https://ipfs.io/ipfs/');
            } else if (uri.startsWith('ar://')) {
                fetchUrl = uri.replace('ar://', 'https://arweave.net/');
            }
            
            const response = await axios.get(fetchUrl, { 
                timeout: 15000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; TokenScanner/1.0)'
                }
            });
            
            if (response.data) {
                return this.findTwitterInMetadata(response.data);
            }
            return null;
            
        } catch (error) {
            return null;
        }
    }

    findTwitterInMetadata(metadata) {
        const twitterPatterns = [
            /https?:\/\/(www\.)?(twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/status\/\d+/gi,
            /https?:\/\/(www\.)?(twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/statuses\/\d+/gi,
            /https?:\/\/(www\.)?(twitter\.com|x\.com)\/[a-zA-Z0-9_]+/gi
        ];
        
        const fieldsToCheck = ['twitter', 'social', 'socials', 'links', 'external_url', 'description', 'attributes'];
        
        for (const field of fieldsToCheck) {
            if (metadata[field]) {
                const fieldStr = JSON.stringify(metadata[field]);
                for (const pattern of twitterPatterns) {
                    const matches = fieldStr.match(pattern);
                    if (matches) {
                        return matches[0];
                    }
                }
            }
        }
        
        const metadataStr = JSON.stringify(metadata);
        for (const pattern of twitterPatterns) {
            const matches = metadataStr.match(pattern);
            if (matches) {
                return matches[0];
            }
        }
        
        return null;
    }
    
    findTwitterUrl(text) {
        if (!text || typeof text !== 'string') return null;
        
        const twitterPatterns = [
            /https?:\/\/(www\.)?(twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/status\/\d+/gi,
            /https?:\/\/(www\.)?(twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/statuses\/\d+/gi,
            /https?:\/\/(www\.)?(twitter\.com|x\.com)\/[a-zA-Z0-9_]+/gi,
            /\/status\/\d+/gi,
            /\/statuses\/\d+/gi
        ];

        for (const pattern of twitterPatterns) {
            const matches = text.match(pattern);
            if (matches) {
                const statusUrls = matches.filter(url => url.includes('/status/') || url.includes('/statuses/'));
                if (statusUrls.length > 0) {
                    return statusUrls[0];
                }
                return matches[0];
            }
        }
        return null;
    }

    startQueueProcessor() {
        setInterval(async () => {
            if (!this.isProcessing && this.processingQueue.length > 0) {
                await this.processQueue();
            }
        }, this.config.processingDelay);

        logger.info(`Queue processor started with ${this.config.processingDelay}ms interval`);
    }

    startMemoryCleanup() {
        setInterval(() => {
            this.clearProcessedTokens();
        }, 10 * 60 * 1000);
        logger.info('Memory cleanup process started');
    }

    async processQueue() {
        if (this.isProcessing || this.processingQueue.length === 0) {
            return;
        }

        this.isProcessing = true;

        try {
            const batchSize = Math.min(3, this.processingQueue.length);
            const batch = this.processingQueue.splice(0, batchSize);

            logger.info(`Processing batch of ${batch.length} items`);

            const promises = batch.map(item => this.processQueueItem(item));
            await Promise.allSettled(promises);

        } catch (error) {
            logger.error('Error processing queue:', error);
            this.stats.errors++;
        } finally {
            this.isProcessing = false;
        }
    }

    getStatus() {
        return {
            processedTokensCount: this.processedTokens.size,
            queueLength: this.processingQueue.length,
            currentlyAnalyzing: this.currentlyAnalyzing.size,
            maxConcurrentAnalyses: this.config.maxConcurrentAnalyses,
            isProcessing: this.isProcessing,
            stats: this.stats,
            config: {
                ...this.config,
                enableViewCountExtraction: this.config.enableViewCountExtraction,
                viewCountTimeout: this.config.viewCountTimeout
            }
        };
    }

    clearProcessedTokens() {
        if (this.processedTokens.size > 5000) {
            logger.info(`Clearing processed tokens cache (${this.processedTokens.size} entries) to prevent memory issues`);
            this.processedTokens.clear();
        }
    }

    getStatsString() {
        const { tokensProcessed, migrationsProcessed, tokensAnalyzed, tokensSkipped, errors, viewCountsExtracted } = this.stats;
        const totalProcessed = tokensProcessed + migrationsProcessed;
        const successRate = totalProcessed > 0 ? ((tokensAnalyzed / totalProcessed) * 100).toFixed(1) : 0;
        const viewExtractionRate = tokensAnalyzed > 0 ? ((viewCountsExtracted / tokensAnalyzed) * 100).toFixed(1) : 0;
        
        return `📊 Stats: ${tokensProcessed} tokens | ${migrationsProcessed} migrations | ${tokensAnalyzed} analyzed | ${tokensSkipped} skipped | ${viewCountsExtracted} views (${viewExtractionRate}%) | ${errors} errors | ${successRate}% success rate`;
    }

    resetStats() {
        this.stats = {
            tokensProcessed: 0,
            migrationsProcessed: 0,
            tokensAnalyzed: 0,
            tokensSkipped: 0,
            viewCountsExtracted: 0,
            errors: 0
        };
        logger.info('Statistics reset');
    }

    async cleanup() {
        logger.info('🧹 Cleaning up TokenDeploymentMonitor...');
        try {
            await this.quickValidator.cleanup();
            await this.fullValidator.cleanup();
            logger.info('✅ TokenDeploymentMonitor cleanup completed');
        } catch (error) {
            logger.error('❌ Error during cleanup:', error);
        }
    }
}

module.exports = TokenDeploymentMonitor;