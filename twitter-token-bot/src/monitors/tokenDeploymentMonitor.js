// src/monitors/tokenDeploymentMonitor.js
const EventEmitter = require('events');
const logger = require('../utils/logger');
const TwitterValidator = require('../validators/twitterValidator');
const AnalysisOrchestrator = require('../orchestrators/analysisOrchestrator');

class TokenDeploymentMonitor extends EventEmitter {
    constructor(config = {}) {
        super();
        this.config = {
            minTwitterViews: config.minTwitterViews || 100000,
            analysisTimeout: config.analysisTimeout || 5 * 60 * 1000, // 5 minutes
            maxConcurrentAnalyses: config.maxConcurrentAnalyses || 3,
            processingDelay: config.processingDelay || 2000, // 2 second delay
            retryAttempts: config.retryAttempts || 3,
            ...config
        };

        this.twitterValidator = new TwitterValidator();
        this.analysisOrchestrator = new AnalysisOrchestrator(this.config);
        
        // Processing state (in-memory only)
        this.processedTokens = new Set();
        this.processingQueue = [];
        this.currentlyAnalyzing = new Set();
        this.isProcessing = false;
        this.stats = {
            tokensProcessed: 0,
            tokensAnalyzed: 0,
            tokensSkipped: 0,
            errors: 0
        };

        // Bind methods
        this.processNewToken = this.processNewToken.bind(this);
        this.processQueue = this.processQueue.bind(this);
        
        // Start queue processing
        this.startQueueProcessor();
        
        // Clean up processed tokens periodically to prevent memory leaks
        this.startMemoryCleanup();
    }

    async processNewToken(tokenEvent) {
        try {
            logger.info(`🔍 Processing new token: ${tokenEvent.name} (${tokenEvent.symbol}) - ${tokenEvent.mint}`);
            this.stats.tokensProcessed++;
            
            // Validate required fields
            if (!this.validateTokenEvent(tokenEvent)) {
                logger.warn(`Invalid token event structure for ${tokenEvent.mint}`);
                this.stats.tokensSkipped++;
                return;
            }

            // Check for duplicates
            if (this.processedTokens.has(tokenEvent.mint)) {
                logger.debug(`Token ${tokenEvent.mint} already processed, skipping`);
                this.stats.tokensSkipped++;
                return;
            }

            // Mark as processed to prevent duplicates
            this.processedTokens.add(tokenEvent.mint);

            // Extract and validate Twitter link
            const twitterLink = await this.extractTwitterLink(tokenEvent);
            if (!twitterLink) {
                logger.debug(`No Twitter link found for ${tokenEvent.symbol} (${tokenEvent.mint})`);
                this.stats.tokensSkipped++;
                return;
            }

            logger.info(`📱 Twitter link found for ${tokenEvent.symbol}: ${twitterLink}`);

            // Add to processing queue
            this.processingQueue.push({
                tokenEvent,
                twitterLink,
                timestamp: Date.now()
            });

            logger.debug(`Added ${tokenEvent.symbol} to processing queue. Queue size: ${this.processingQueue.length}`);

        } catch (error) {
            logger.error(`Error processing new token ${tokenEvent.mint}:`, error);
            this.stats.errors++;
        }
    }

    validateTokenEvent(tokenEvent) {
        const requiredFields = ['mint', 'name', 'symbol'];
        return requiredFields.every(field => 
            tokenEvent[field] && typeof tokenEvent[field] === 'string' && tokenEvent[field].trim().length > 0
        );
    }

    async extractTwitterLink(tokenEvent) {
        console.log('🔍 EXTRACTING TWITTER LINK FOR:', tokenEvent.symbol);
        console.log('   - Checking direct fields first...');
        
        // First check if there are any social fields directly
        const possibleFields = [
            'twitter',
            'social',
            'socials'
        ];
    
        for (const field of possibleFields) {
            if (tokenEvent[field]) {
                console.log(`   - Found direct field '${field}':`, tokenEvent[field]);
                const twitterLink = this.findTwitterUrl(tokenEvent[field]);
                if (twitterLink) {
                    console.log(`   - ✅ Twitter link found in direct field: ${twitterLink}`);
                    return twitterLink;
                }
            }
        }
    
        // If uri field exists, try to fetch metadata from IPFS/Arweave
        if (tokenEvent.uri) {
            console.log(`   - No direct fields, fetching metadata from URI: ${tokenEvent.uri}`);
            const result = await this.extractTwitterFromUri(tokenEvent.uri);
            if (result) {
                console.log(`   - ✅ Twitter link found in metadata: ${result}`);
                return result;
            } else {
                console.log(`   - ❌ No Twitter link found in metadata`);
            }
        } else {
            console.log(`   - ❌ No URI field found`);
        }
    
        console.log(`   - ❌ No Twitter link found for ${tokenEvent.symbol}`);
        return null;
    }
    
    findTwitterUrl(text) {
        if (!text || typeof text !== 'string') return null;
        
        // Twitter URL patterns - more comprehensive
        const twitterPatterns = [
            // Full status URLs
            /https?:\/\/(www\.)?(twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/status\/\d+/gi,
            /https?:\/\/(www\.)?(twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/statuses\/\d+/gi,
            // Profile URLs that might contain status links
            /https?:\/\/(www\.)?(twitter\.com|x\.com)\/[a-zA-Z0-9_]+/gi,
            // Just status URLs without domain
            /\/status\/\d+/gi,
            /\/statuses\/\d+/gi
        ];

        for (const pattern of twitterPatterns) {
            const matches = text.match(pattern);
            if (matches) {
                // Return the first match, preferring status URLs over profile URLs
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
        // Clean up processed tokens every 10 minutes to prevent memory leaks
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
            // Process items in batches to avoid overwhelming the system
            const batchSize = Math.min(3, this.processingQueue.length);
            const batch = this.processingQueue.splice(0, batchSize);

            logger.info(`Processing batch of ${batch.length} tokens`);

            // Process each item in the batch
            const promises = batch.map(item => this.processQueueItem(item));
            await Promise.allSettled(promises);

        } catch (error) {
            logger.error('Error processing queue:', error);
            this.stats.errors++;
        } finally {
            this.isProcessing = false;
        }
    }

    async processQueueItem(item) {
        const { tokenEvent, twitterLink, timestamp } = item;
        const operationId = `${tokenEvent.symbol}_${Date.now()}`;

        try {
            logger.info(`🔄 [${operationId}] Processing queued token: ${tokenEvent.symbol}`);

            // Check if too much time has passed (10 minutes)
            if (Date.now() - timestamp > 10 * 60 * 1000) {
                logger.warn(`[${operationId}] Token too old, skipping: ${tokenEvent.symbol}`);
                this.stats.tokensSkipped++;
                return;
            }

            // Validate Twitter engagement
            const twitterMetrics = await this.twitterValidator.validateEngagement(twitterLink);
            
            if (!twitterMetrics) {
                logger.info(`[${operationId}] Failed to get Twitter metrics for ${tokenEvent.symbol}`);
                this.stats.tokensSkipped++;
                return;
            }

            logger.info(`[${operationId}] Twitter metrics for ${tokenEvent.symbol}: ${twitterMetrics.views} views, ${twitterMetrics.likes} likes`);

            // Check if meets engagement threshold
            if (twitterMetrics.views < this.config.minTwitterViews) {
                logger.info(`[${operationId}] ${tokenEvent.symbol} has ${twitterMetrics.views} views (< ${this.config.minTwitterViews}), skipping analysis`);
                this.stats.tokensSkipped++;
                return;
            }

            // Token meets criteria - trigger analysis
            logger.info(`🚀 [${operationId}] ${tokenEvent.symbol} meets criteria (${twitterMetrics.views} views)! Starting bundle analysis...`);
            
            await this.triggerAnalysis(tokenEvent, twitterMetrics, operationId);

        } catch (error) {
            logger.error(`[${operationId}] Error processing queue item:`, error);
            this.stats.errors++;
        }
    }

    async triggerAnalysis(tokenEvent, twitterMetrics, operationId) {
        // Check concurrent analysis limit
        if (this.currentlyAnalyzing.size >= this.config.maxConcurrentAnalyses) {
            logger.warn(`[${operationId}] Maximum concurrent analyses reached, queuing for later`);
            // Re-queue for later processing
            setTimeout(() => {
                this.processingQueue.unshift({ 
                    tokenEvent, 
                    twitterLink: twitterMetrics.link, 
                    timestamp: Date.now() 
                });
            }, 30000); // Retry in 30 seconds
            return;
        }

        this.currentlyAnalyzing.add(tokenEvent.mint);

        try {
            // Start bundle analysis
            const analysisResult = await this.analysisOrchestrator.analyzeToken({
                tokenAddress: tokenEvent.mint,
                tokenInfo: {
                    name: tokenEvent.name,
                    symbol: tokenEvent.symbol,
                    creator: tokenEvent.traderPublicKey || tokenEvent.creator
                },
                twitterMetrics,
                operationId
            });

            if (analysisResult.success) {
                logger.info(`✅ [${operationId}] Bundle analysis completed successfully for ${tokenEvent.symbol}`);
                this.stats.tokensAnalyzed++;
                
                // Emit success event for external listeners
                this.emit('analysisCompleted', {
                    tokenEvent,
                    twitterMetrics,
                    analysisResult,
                    operationId
                });
            } else {
                logger.error(`❌ [${operationId}] Bundle analysis failed for ${tokenEvent.symbol}:`, analysisResult.error);
                this.stats.errors++;
            }

        } catch (error) {
            logger.error(`[${operationId}] Analysis orchestration error:`, error);
            this.stats.errors++;
        } finally {
            this.currentlyAnalyzing.delete(tokenEvent.mint);
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
            config: this.config
        };
    }

    clearProcessedTokens() {
        // Clear old entries to prevent memory issues
        if (this.processedTokens.size > 5000) {
            logger.info(`Clearing processed tokens cache (${this.processedTokens.size} entries) to prevent memory issues`);
            this.processedTokens.clear();
        }
    }

    // Get human-readable stats
    getStatsString() {
        const { tokensProcessed, tokensAnalyzed, tokensSkipped, errors } = this.stats;
        const successRate = tokensProcessed > 0 ? ((tokensAnalyzed / tokensProcessed) * 100).toFixed(1) : 0;
        
        return `📊 Stats: ${tokensProcessed} processed | ${tokensAnalyzed} analyzed | ${tokensSkipped} skipped | ${errors} errors | ${successRate}% success rate`;
    }

    // Reset stats (useful for monitoring)
    resetStats() {
        this.stats = {
            tokensProcessed: 0,
            tokensAnalyzed: 0,
            tokensSkipped: 0,
            errors: 0
        };
        logger.info('Statistics reset');
    }
}

module.exports = TokenDeploymentMonitor;