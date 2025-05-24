// src/monitors/tokenDeploymentMonitor.js - Optimized & Clean Version
const EventEmitter = require('events');
const axios = require('axios');
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
            analysisTimeout: parseInt(process.env.ANALYSIS_TIMEOUT) || config.analysisTimeout || 3 * 60 * 1000, // Reduced to 3 min
            maxConcurrentAnalyses: parseInt(process.env.MAX_CONCURRENT_ANALYSES) || config.maxConcurrentAnalyses || 2, // Reduced to 2
            processingDelay: parseInt(process.env.PROCESSING_DELAY) || config.processingDelay || 1000, // Reduced to 1s
            enableViewCountExtraction: config.enableViewCountExtraction !== false,
            viewCountTimeout: config.viewCountTimeout || 10000, // Reduced to 10 seconds
            ...config
        };

        logger.info(`📋 TokenDeploymentMonitor Config:`);
        logger.info(`   • Min Twitter Views: ${this.config.minTwitterViews.toLocaleString()}`);
        logger.info(`   • Min Twitter Likes: ${this.config.minTwitterLikes.toLocaleString()}`);
        logger.info(`   • View Count Extraction: ${this.config.enableViewCountExtraction ? 'Enabled' : 'Disabled'}`);

        // Initialize validators with optimized settings
        this.quickValidator = new TwitterValidator({
            enablePageExtraction: false,
            timeout: 3000, // Reduced timeout
            maxRetries: 2   // Reduced retries
        });
        
        this.fullValidator = new TwitterValidator({
            enablePageExtraction: true,
            timeout: this.config.viewCountTimeout,
            maxRetries: 1   // Only 1 retry for view extraction
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

            // Extract Twitter link - ONLY status URLs
            const twitterLink = await this.extractTwitterStatusLink(tokenEvent);

            if (!twitterLink) {
                logger.debug(`No valid tweet status URL found for ${tokenEvent.symbol}`);
                this.stats.tokensSkipped++;
                return;
            }

            logger.info(`📱 Valid tweet found for ${tokenEvent.symbol}: ${twitterLink}`);

            // Add to processing queue
            this.processingQueue.push({
                tokenEvent,
                twitterLink,
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
        const { tokenEvent, twitterLink, timestamp, timer } = item;
        const operationId = timer.operationId;

        try {
            logger.info(`🔄 [${operationId}] Processing: ${tokenEvent.symbol}`);

            // Check if item is too old (10 minutes)
            if (Date.now() - timestamp > 10 * 60 * 1000) {
                logger.warn(`[${operationId}] Item too old, skipping: ${tokenEvent.symbol}`);
                this.stats.tokensSkipped++;
                return;
            }

            // STEP 1: Quick likes check (fast validation)
            logger.debug(`[${operationId}] 🚀 Quick likes check: ${twitterLink}`);
            const quickMetrics = await this.quickValidator.quickLikesCheck(twitterLink);

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
            await this.runQualifiedAnalysis(tokenEvent, twitterLink, quickMetrics, operationId, timer);

        } catch (error) {
            logger.error(`[${operationId}] Error processing queue item:`, error);
            this.stats.errors++;
        }
    }

    async runQualifiedAnalysis(tokenEvent, twitterLink, quickMetrics, operationId, timer) {
        // Check concurrent limit
        if (this.currentlyAnalyzing.size >= this.config.maxConcurrentAnalyses) {
            logger.warn(`[${operationId}] Max concurrent analyses reached, requeuing`);
            setTimeout(() => {
                this.processingQueue.unshift({ 
                    tokenEvent, 
                    twitterLink, 
                    timestamp: Date.now(),
                    timer 
                });
            }, 30000);
            return;
        }

        this.currentlyAnalyzing.add(tokenEvent.mint);

        try {
            let finalTwitterMetrics = {
                ...quickMetrics,
                link: twitterLink,
                views: 0,
                retweets: 0,
                replies: 0
            };

            // EXPENSIVE OPERATION 1: View extraction (only if enabled)
            if (this.config.enableViewCountExtraction) {
                logger.info(`[${operationId}] 📊 Extracting view count...`);
                try {
                    const viewStart = Date.now();
                    const fullMetrics = await this.fullValidator.validateEngagement(twitterLink);
                    const viewTime = Date.now() - viewStart;
                    
                    if (fullMetrics && (fullMetrics.views > 0 || fullMetrics.likes > quickMetrics.likes)) {
                        finalTwitterMetrics = {
                            link: twitterLink,
                            views: fullMetrics.views || 0,
                            likes: Math.max(fullMetrics.likes || 0, quickMetrics.likes || 0),
                            retweets: fullMetrics.retweets || 0,
                            replies: fullMetrics.replies || 0,
                            publishedAt: fullMetrics.publishedAt || quickMetrics.publishedAt
                        };
                        
                        this.stats.viewCountsExtracted++;
                        logger.info(`[${operationId}] ✅ Views extracted (${viewTime}ms): ${finalTwitterMetrics.views} views, ${finalTwitterMetrics.likes} likes`);
                    } else {
                        logger.warn(`[${operationId}] ⚠️ View extraction failed (${viewTime}ms)`);
                    }
                } catch (error) {
                    logger.warn(`[${operationId}] ⚠️ View extraction error: ${error.message}`);
                }
            }

            // EXPENSIVE OPERATION 2: Token analysis (bundle + holders)
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

    // OPTIMIZED: Only extract valid tweet status URLs
    async extractTwitterStatusLink(tokenEvent) {
        // Check direct fields first
        const possibleFields = ['twitter', 'social', 'socials'];
        
        for (const field of possibleFields) {
            if (tokenEvent[field]) {
                const statusUrl = this.findTwitterStatusUrl(tokenEvent[field]);
                if (statusUrl) {
                    return statusUrl;
                }
            }
        }

        // Check metadata URI if direct fields failed
        if (tokenEvent.uri) {
            return await this.extractTwitterFromUri(tokenEvent.uri);
        }

        return null;
    }

    findTwitterStatusUrl(text) {
        if (!text || typeof text !== 'string') return null;
        
        // STRICT: Only accept tweet status URLs
        const statusPatterns = [
            /https?:\/\/(www\.)?(twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/status\/\d+/gi,
            /https?:\/\/(www\.)?(twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/statuses\/\d+/gi
        ];

        for (const pattern of statusPatterns) {
            const matches = text.match(pattern);
            if (matches && matches.length > 0) {
                const statusUrl = matches[0];
                logger.debug(`Found valid tweet status: ${statusUrl}`);
                return statusUrl;
            }
        }
        
        // Log what we rejected
        const profilePattern = /https?:\/\/(www\.)?(twitter\.com|x\.com)\/[a-zA-Z0-9_]+/gi;
        const profileMatches = text.match(profilePattern);
        if (profileMatches && profileMatches.length > 0) {
            logger.debug(`Rejected Twitter profile URL: ${profileMatches[0]}`);
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
                timeout: 10000, // Reduced timeout
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; TokenScanner/1.0)'
                }
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
        
        // Check specific fields
        for (const field of fieldsToCheck) {
            if (metadata[field]) {
                const fieldStr = JSON.stringify(metadata[field]);
                for (const pattern of statusPatterns) {
                    const matches = fieldStr.match(pattern);
                    if (matches && matches.length > 0) {
                        logger.debug(`Found tweet status in '${field}': ${matches[0]}`);
                        return matches[0];
                    }
                }
            }
        }
        
        // Check entire metadata as fallback
        const metadataStr = JSON.stringify(metadata);
        for (const pattern of statusPatterns) {
            const matches = metadataStr.match(pattern);
            if (matches && matches.length > 0) {
                logger.debug(`Found tweet status in metadata: ${matches[0]}`);
                return matches[0];
            }
        }
        
        return null;
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
            // Process larger batches for efficiency
            const batchSize = Math.min(5, this.processingQueue.length);
            const batch = this.processingQueue.splice(0, batchSize);

            logger.info(`Processing batch of ${batch.length} items`);

            // Filter out old items before processing
            const validItems = batch.filter(item => {
                const age = Date.now() - item.timestamp;
                if (age > 10 * 60 * 1000) { // 10 minutes
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
            if (this.processedTokens.size > 3000) { // Reduced threshold
                logger.info(`Clearing processed tokens cache (${this.processedTokens.size} entries)`);
                this.processedTokens.clear();
            }
        }, 5 * 60 * 1000); // Every 5 minutes
        
        logger.info('Memory cleanup process started');
    }

    setupShutdownCleanup() {
        const cleanup = async () => {
            logger.info('🧹 Cleaning up TokenDeploymentMonitor...');
            try {
                await this.quickValidator.cleanup();
                await this.fullValidator.cleanup();
                logger.info('✅ TokenDeploymentMonitor cleanup completed');
            } catch (error) {
                logger.error('❌ Error during cleanup:', error);
            }
        };

        process.on('SIGINT', cleanup);
        process.on('SIGTERM', cleanup);
        process.on('exit', cleanup);
    }

    // Status and monitoring methods
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
}

module.exports = TokenDeploymentMonitor;