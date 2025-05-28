// src/monitors/migrationMonitor.js - Updated to use PumpFun API for metadata
const EventEmitter = require('events');
const logger = require('../utils/logger');
const TwitterValidator = require('../validators/twitterValidator');
const AnalysisOrchestrator = require('../orchestrators/analysisOrchestrator');
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
        logger.info(`   • Min Twitter Views: ${this.config.minTwitterViews.toLocaleString()}`);
        logger.info(`   • Min Twitter Likes: ${this.config.minTwitterLikes.toLocaleString()}`);
        logger.info(`   • Analysis Timeout: ${this.config.analysisTimeout / 1000}s`);
        logger.info(`   • View Count Extraction: ${this.config.enableViewCountExtraction ? 'Enabled' : 'Disabled'}`);

        // Single TwitterValidator instance
        this.twitterValidator = new TwitterValidator({
            enablePageExtraction: this.config.enableViewCountExtraction,
            timeout: this.config.viewCountTimeout,
            quickTimeout: 5000
        });
        
        this.analysisOrchestrator = new AnalysisOrchestrator({
            ...this.config,
            botType: 'migration'
        });
        
        this.processedTokens = new Set();
        this.processingQueue = [];
        this.currentlyAnalyzing = new Set();
        this.isProcessing = false;
        this.stats = {
            migrationsReceived: 0,
            migrationsProcessed: 0,
            analysesCompleted: 0,
            migrationsSkipped: 0,
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
        
        try {
            logger.info(`🔄 Processing token migration: ${migrationEvent.mint}`);
            this.stats.migrationsReceived++;
            
            if (this.processedTokens.has(migrationEvent.mint)) {
                logger.debug(`Migration token ${migrationEvent.mint} already processed, skipping`);
                this.stats.migrationsSkipped++;
                return;
            }

            this.processedTokens.add(migrationEvent.mint);

            // STEP 1: Fetch token metadata from PumpFun API
            logger.debug(`🔍 Fetching token metadata for migration: ${migrationEvent.mint}`);
            
            let tokenInfo;
            try {
                tokenInfo = await pumpfunApi.getTokenInfo(migrationEvent.mint);
            } catch (error) {
                logger.warn(`Failed to fetch token info from PumpFun for ${migrationEvent.mint}:`, error.message);
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

            logger.info(`✅ Token metadata fetched: ${tokenInfo.name} (${tokenInfo.symbol})`);

            // STEP 2: Extract Twitter URL - check both direct fields and metadata_uri
            const twitterUrl = await this.extractTwitterUrlFromTokenInfo(tokenInfo);

            if (!twitterUrl) {
                logger.info(`No Twitter status URL found for migration ${tokenInfo.symbol}, skipping`);
                this.stats.migrationsSkipped++;
                return;
            }

            logger.info(`📱 Twitter status URL found for migration ${tokenInfo.symbol}: ${twitterUrl}`);

            // STEP 3: Create complete token event and add to processing queue
            const completeTokenEvent = {
                ...migrationEvent,
                eventType: 'migration',
                name: tokenInfo.name,
                symbol: tokenInfo.symbol,
                timer: timer,
                // Store the fetched token info
                tokenInfo: tokenInfo
            };

            this.processingQueue.push({
                tokenEvent: completeTokenEvent,
                twitterUrl,
                timestamp: Date.now(),
                eventType: 'migration',
                timer: timer
            });

            logger.debug(`Added migration ${tokenInfo.symbol} to processing queue. Queue size: ${this.processingQueue.length}`);

        } catch (error) {
            logger.error(`Error processing token migration ${migrationEvent.mint}:`, error);
            this.stats.errors++;
        }
    }

    async extractTwitterUrlFromTokenInfo(tokenInfo) {
        // STEP 1: Check direct Twitter field first
        if (tokenInfo.twitter) {
            const directTwitterUrl = this.findTwitterStatusUrl(tokenInfo.twitter);
            if (directTwitterUrl) {
                logger.debug(`Twitter status URL found in direct field: ${directTwitterUrl}`);
                return directTwitterUrl;
            }
        }

        // STEP 2: Check other fields (website, telegram might contain Twitter links)
        const fieldsToCheck = ['website', 'telegram', 'description'];
        for (const field of fieldsToCheck) {
            if (tokenInfo[field]) {
                const twitterUrl = this.findTwitterStatusUrl(tokenInfo[field]);
                if (twitterUrl) {
                    logger.debug(`Twitter status URL found in ${field} field: ${twitterUrl}`);
                    return twitterUrl;
                }
            }
        }

        // STEP 3: Check metadata_uri if available
        if (tokenInfo.metadata_uri) {
            logger.debug(`Checking metadata_uri for Twitter status URL: ${tokenInfo.metadata_uri}`);
            try {
                const metadataTwitterUrl = await this.extractFromMetadataUri(tokenInfo.metadata_uri);
                if (metadataTwitterUrl) {
                    logger.debug(`Twitter status URL found in metadata: ${metadataTwitterUrl}`);
                    return metadataTwitterUrl;
                }
            } catch (error) {
                logger.debug(`Failed to fetch metadata from URI: ${error.message}`);
            }
        }

        return null;
    }

    findTwitterStatusUrl(text) {
        if (!text || typeof text !== 'string') return null;
        
        // Only look for status URLs (tweets), not profiles
        const statusPatterns = [
            /https?:\/\/(www\.)?(twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/status\/\d+/gi,
            /https?:\/\/(www\.)?(twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/statuses\/\d+/gi
        ];

        for (const pattern of statusPatterns) {
            const matches = text.match(pattern);
            if (matches) return matches[0];
        }
        
        return null;
    }

    async extractFromMetadataUri(uri) {
        try {
            let fetchUrl = uri;
            if (uri.startsWith('ipfs://')) {
                fetchUrl = uri.replace('ipfs://', 'https://ipfs.io/ipfs/');
            } else if (uri.startsWith('ar://')) {
                fetchUrl = uri.replace('ar://', 'https://arweave.net/');
            }
            
            const axios = require('axios');
            const response = await axios.get(fetchUrl, { 
                timeout: 10000,
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TokenScanner/1.0)' }
            });
            
            if (response.data) {
                return this.findTwitterStatusInMetadata(response.data);
            }
            return null;
            
        } catch (error) {
            logger.debug(`Failed to fetch metadata from ${uri}: ${error.message}`);
            return null;
        }
    }

    findTwitterStatusInMetadata(metadata) {
        const statusPatterns = [
            /https?:\/\/(www\.)?(twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/status\/\d+/gi,
            /https?:\/\/(www\.)?(twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/statuses\/\d+/gi
        ];
        
        const fieldsToCheck = ['twitter', 'social', 'socials', 'links', 'external_url', 'description'];
        
        // Check specific fields first
        for (const field of fieldsToCheck) {
            if (metadata[field]) {
                const fieldStr = JSON.stringify(metadata[field]);
                for (const pattern of statusPatterns) {
                    const matches = fieldStr.match(pattern);
                    if (matches) return matches[0];
                }
            }
        }
        
        // Check entire metadata as fallback
        const metadataStr = JSON.stringify(metadata);
        for (const pattern of statusPatterns) {
            const matches = metadataStr.match(pattern);
            if (matches) return matches[0];
        }
        
        return null;
    }

    async processQueueItem(item) {
        const { tokenEvent, twitterUrl, timestamp, eventType, timer } = item;
        const operationId = timer?.operationId || `${tokenEvent.symbol}_${eventType}_${Date.now()}`;

        try {
            this.stats.migrationsProcessed++;
            logger.info(`🔄 [${operationId}] Processing queued migration: ${tokenEvent.symbol}`);

            // Check if item is too old
            if (Date.now() - timestamp > 15 * 60 * 1000) {
                logger.warn(`[${operationId}] Migration too old, skipping: ${tokenEvent.symbol}`);
                this.stats.migrationsSkipped++;
                return;
            }

            // STEP 1: Quick likes check (SAME AS CREATION)
            logger.debug(`[${operationId}] 🚀 Quick likes check: ${twitterUrl}`);
            const quickMetrics = await this.twitterValidator.quickLikesCheck(twitterUrl);

            if (!quickMetrics || !quickMetrics.likes) {
                logger.info(`[${operationId}] Twitter validation failed for ${tokenEvent.symbol}`);
                this.stats.migrationsSkipped++;
                return;
            }

            logger.info(`[${operationId}] ⚡ ${quickMetrics.likes} likes found`);

            // STEP 2: Check engagement threshold (SAME AS CREATION)
            if (quickMetrics.likes < this.config.minTwitterLikes) {
                logger.info(`[${operationId}] ${tokenEvent.symbol} has ${quickMetrics.likes} likes (< ${this.config.minTwitterLikes}), skipping`);
                this.stats.migrationsSkipped++;
                return;
            }

            // STEP 3: QUALIFIED! Run expensive operations (SAME AS CREATION)
            logger.info(`🚀 [${operationId}] ${tokenEvent.symbol} qualified with ${quickMetrics.likes} likes! Starting analysis...`);
            await this.runQualifiedAnalysis(tokenEvent, twitterUrl, quickMetrics, operationId, timer);

        } catch (error) {
            logger.error(`[${operationId}] Error processing migration queue item:`, error);
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
                    eventType: 'migration',
                    timer 
                });
            }, 30000);
            return;
        }

        this.currentlyAnalyzing.add(tokenEvent.mint);

        try {
            let finalTwitterMetrics = quickMetrics;

            // Get full metrics including views if enabled (SAME AS CREATION)
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

            // Run token analysis (SAME AS CREATION)
            logger.info(`[${operationId}] 🔬 Running token analysis...`);
            const analysisStart = Date.now();
            
            const analysisResult = await this.analysisOrchestrator.analyzeToken({
                tokenAddress: tokenEvent.mint,
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
            });
            
            const analysisTime = Date.now() - analysisStart;

            // Handle result (SAME AS CREATION)
            if (analysisResult.success) {
                logger.info(`✅ [${operationId}] Analysis completed (${analysisTime}ms)`);
                this.stats.analysesCompleted++;
                
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
                ...this.config,
                enableViewCountExtraction: this.config.enableViewCountExtraction,
                viewCountTimeout: this.config.viewCountTimeout
            },
            enabledAnalyses: this.analysisOrchestrator.getEnabledAnalyses()
        };
    }

    clearProcessedTokens() {
        if (this.processedTokens.size > 1000) {
            logger.info(`Clearing processed migrations cache (${this.processedTokens.size} entries)`);
            this.processedTokens.clear();
        }
    }

    getStatsString() {
        const { migrationsReceived, migrationsProcessed, analysesCompleted, migrationsSkipped, errors, viewCountsExtracted, metadataFetchFailures } = this.stats;
        const successRate = migrationsReceived > 0 ? ((analysesCompleted / migrationsReceived) * 100).toFixed(1) : 0;
        const viewExtractionRate = analysesCompleted > 0 ? ((viewCountsExtracted / analysesCompleted) * 100).toFixed(1) : 0;
        
        return `📊 Migration Stats: ${migrationsReceived} received | ${migrationsProcessed} processed | ${analysesCompleted} analyzed | ${migrationsSkipped} skipped | ${metadataFetchFailures} metadata failures | ${viewCountsExtracted} views (${viewExtractionRate}%) | ${errors} errors | ${successRate}% success rate`;
    }

    resetStats() {
        this.stats = {
            migrationsReceived: 0,
            migrationsProcessed: 0,
            analysesCompleted: 0,
            migrationsSkipped: 0,
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