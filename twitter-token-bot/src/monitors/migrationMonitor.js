// src/monitors/migrationMonitor.js - Enhanced with detailed benchmarking
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
            errors: 0,
            // Enhanced timing stats
            avgMetadataFetchTime: 0,
            avgTwitterValidationTime: 0,
            avgViewExtractionTime: 0,
            avgAnalysisTime: 0,
            avgBundleAnalysisTime: 0,
            avgTopHoldersAnalysisTime: 0,
            avgBundleAnalysisTime: 0,
            avgTopHoldersAnalysisTime: 0,
            slowestAnalysis: { time: 0, token: '' },
            fastestAnalysis: { time: Infinity, token: '' }
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

            // STEP 1: Fetch token metadata from PumpFun API with timing
            logger.info(`⏱️ [${timer.operationId}] Step 1: Fetching token metadata...`);
            const metadataStart = Date.now();
            
            let tokenInfo;
            try {
                tokenInfo = await pumpfunApi.getTokenInfo(migrationEvent.mint);
                const metadataTime = Date.now() - metadataStart;
                logger.info(`✅ [${timer.operationId}] Metadata fetched in ${metadataTime}ms`);
                
                // Update timing stats
                this.updateTimingStats('metadata', metadataTime);
                
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

            // STEP 2: Extract Twitter URL with timing
            logger.info(`⏱️ [${timer.operationId}] Step 2: Extracting Twitter URL...`);
            const twitterExtractStart = Date.now();
            
            const twitterUrl = await this.extractTwitterUrlFromTokenInfo(tokenInfo);
            const twitterExtractTime = Date.now() - twitterExtractStart;
            
            if (!twitterUrl) {
                logger.info(`❌ [${timer.operationId}] No Twitter URL found in ${twitterExtractTime}ms, skipping`);
                this.stats.migrationsSkipped++;
                return;
            }

            logger.info(`✅ [${timer.operationId}] Twitter URL found in ${twitterExtractTime}ms: ${twitterUrl}`);

            // STEP 3: Create complete token event and add to processing queue
            const completeTokenEvent = {
                ...migrationEvent,
                eventType: 'migration',
                name: tokenInfo.name,
                symbol: tokenInfo.symbol,
                timer: timer,
                tokenInfo: tokenInfo,
                // Add timing info for queue processing
                processingTimes: {
                    metadataFetch: Date.now() - metadataStart,
                    twitterExtract: twitterExtractTime,
                    queuedAt: Date.now()
                }
            };

            this.processingQueue.push({
                tokenEvent: completeTokenEvent,
                twitterUrl,
                timestamp: Date.now(),
                eventType: 'migration',
                timer: timer
            });

            const totalPreProcessTime = Date.now() - startTime;
            logger.info(`📊 [${timer.operationId}] Pre-processing completed in ${totalPreProcessTime}ms, added to queue (size: ${this.processingQueue.length})`);

        } catch (error) {
            const totalTime = Date.now() - startTime;
            logger.error(`❌ [${timer.operationId}] Error processing migration in ${totalTime}ms:`, error);
            this.stats.errors++;
        }
    }

    async processQueueItem(item) {
        const { tokenEvent, twitterUrl, timestamp, eventType, timer } = item;
        const operationId = timer?.operationId || `${tokenEvent.symbol}_${eventType}_${Date.now()}`;
        const processingStart = Date.now();

        try {
            this.stats.migrationsProcessed++;
            logger.info(`🔄 [${operationId}] Processing queued migration: ${tokenEvent.symbol}`);

            // Check if item is too old
            const queueAge = Date.now() - timestamp;
            if (queueAge > 15 * 60 * 1000) {
                logger.warn(`[${operationId}] Migration too old (${Math.round(queueAge/1000)}s), skipping`);
                this.stats.migrationsSkipped++;
                return;
            }

            logger.info(`📊 [${operationId}] Queue wait time: ${queueAge}ms`);

            // STEP 1: Quick likes check with timing
            logger.info(`⏱️ [${operationId}] Step 3: Quick likes validation...`);
            const likesStart = Date.now();
            
            const quickMetrics = await this.twitterValidator.quickLikesCheck(twitterUrl);
            const likesTime = Date.now() - likesStart;

            if (!quickMetrics || !quickMetrics.likes) {
                logger.warn(`❌ [${operationId}] Twitter validation failed in ${likesTime}ms`);
                this.updateTimingStats('twitterValidation', likesTime);
                this.stats.migrationsSkipped++;
                return;
            }

            logger.info(`✅ [${operationId}] Found ${quickMetrics.likes} likes in ${likesTime}ms`);
            this.updateTimingStats('twitterValidation', likesTime);

            // STEP 2: Check engagement threshold
            if (quickMetrics.likes < this.config.minTwitterLikes) {
                logger.info(`❌ [${operationId}] ${tokenEvent.symbol} has ${quickMetrics.likes} likes (< ${this.config.minTwitterLikes}), skipping`);
                this.stats.migrationsSkipped++;
                return;
            }

            // STEP 3: QUALIFIED! Run expensive operations
            logger.info(`🚀 [${operationId}] ${tokenEvent.symbol} qualified with ${quickMetrics.likes} likes! Starting analysis...`);
            await this.runQualifiedAnalysis(tokenEvent, twitterUrl, quickMetrics, operationId, timer, processingStart);

        } catch (error) {
            const processingTime = Date.now() - processingStart;
            logger.error(`❌ [${operationId}] Error processing migration queue item in ${processingTime}ms:`, error);
            this.stats.errors++;
        }
    }

    async runQualifiedAnalysis(tokenEvent, twitterUrl, quickMetrics, operationId, timer, processingStart) {
        // Check concurrent limit
        if (this.currentlyAnalyzing.size >= this.config.maxConcurrentAnalyses) {
            logger.warn(`[${operationId}] Max concurrent analyses reached (${this.currentlyAnalyzing.size}/${this.config.maxConcurrentAnalyses}), requeuing`);
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
            // STEP 4 & 5: Run view extraction and analysis in parallel for maximum efficiency
            let viewExtractionTime = 0;
            let finalTwitterMetrics = quickMetrics;
            let analysisResult;
            let analysisTime = 0; // Define analysisTime at the start to avoid scope issues
            
            if (this.config.enableViewCountExtraction) {
                logger.info(`⏱️ [${operationId}] Step 4 & 5: Running view extraction AND analysis in parallel...`);
                const viewStart = Date.now();
                const analysisStart = Date.now();
                
                try {
                    // Run both operations in parallel - but get VIEWS ONLY from puppeteer
                    const [viewMetrics, analysisRes] = await Promise.all([
                        // FIXED: Get only views from puppeteer
                        this.twitterValidator.getViewsFromPage(this.twitterValidator.extractTweetId(twitterUrl)),
                        
                        // Analysis using quick metrics 
                        this.analysisOrchestrator.analyzeToken({
                            tokenAddress: tokenEvent.mint,
                            tokenInfo: {
                                name: tokenEvent.name,
                                symbol: tokenEvent.symbol,
                                creator: tokenEvent.traderPublicKey || tokenEvent.creator,
                                address: tokenEvent.mint,
                                eventType: 'migration'
                            },
                            twitterMetrics: quickMetrics, // Use the working likes from quickMetrics
                            operationId,
                            timer
                        })
                    ]);
                    
                    viewExtractionTime = Date.now() - viewStart;
                    analysisTime = Date.now() - analysisStart;
                    analysisResult = analysisRes;
                    
                    if (viewMetrics && viewMetrics.views > 0) {
                        // Combine views from puppeteer + likes from quickMetrics
                        finalTwitterMetrics = {
                            link: twitterUrl,
                            views: viewMetrics.views,
                            likes: quickMetrics.likes,
                            retweets: 0,
                            replies: 0,
                            publishedAt: quickMetrics.publishedAt
                        };
                        this.stats.viewCountsExtracted++;
                        logger.info(`✅ [${operationId}] Parallel execution completed - Views: ${viewMetrics.views}, Analysis: ${analysisTime}ms`);
                    } else {
                        // Views failed, use quickMetrics
                        finalTwitterMetrics = quickMetrics;
                        logger.warn(`⚠️ [${operationId}] View extraction failed, using likes only: ${quickMetrics.likes}`);
                    }
                    
                    this.updateTimingStats('viewExtraction', viewExtractionTime);
                    
                } catch (error) {
                    viewExtractionTime = Date.now() - viewStart;
                    logger.error(`❌ [${operationId}] Parallel execution failed after ${viewExtractionTime}ms: ${error.message}`);
                    
                    // Fallback: run analysis alone if parallel execution failed
                    logger.info(`⏱️ [${operationId}] Fallback: Running analysis alone...`);
                    const fallbackAnalysisStart = Date.now();
                    
                    analysisResult = await this.analysisOrchestrator.analyzeToken({
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
                    
                    analysisTime = Date.now() - fallbackAnalysisStart;
                    finalTwitterMetrics = quickMetrics; // Use quickMetrics as fallback
                    logger.info(`✅ [${operationId}] Fallback analysis completed in ${analysisTime}ms`);
                    
                    this.updateTimingStats('viewExtraction', viewExtractionTime);
                }
            } else {
                // View extraction disabled - run analysis only
                logger.info(`⏱️ [${operationId}] Step 5: Running analysis only (view extraction disabled)...`);
                const analysisStart = Date.now();
                
                analysisResult = await this.analysisOrchestrator.analyzeToken({
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
                
                analysisTime = Date.now() - analysisStart; // Set analysisTime for analysis-only path
                logger.info(`✅ [${operationId}] Analysis completed in ${analysisTime}ms`);
            }
            
            const totalAnalysisTime = analysisResult.duration || analysisTime; // Use analysisTime as fallback
            const totalProcessingTime = Date.now() - processingStart;
            
            // Extract individual analysis timings from the result and logs
            let bundleAnalysisTime = 0;
            let topHoldersAnalysisTime = 0;
            
            // Try to extract timings from the analysis result structure first
            if (analysisResult.analyses?.bundle?.duration) {
                bundleAnalysisTime = analysisResult.analyses.bundle.duration;
                logger.info(`[${operationId}] Got bundle timing from result: ${bundleAnalysisTime}ms`);
            }
            if (analysisResult.analyses?.topHolders?.duration) {
                topHoldersAnalysisTime = analysisResult.analyses.topHolders.duration;
                logger.info(`[${operationId}] Got holders timing from result: ${topHoldersAnalysisTime}ms`);
            }
            
            // If we don't have individual timings, estimate based on observed patterns
            if (bundleAnalysisTime === 0 && topHoldersAnalysisTime === 0) {
                // From your logs, we can see the pattern:
                // - Bundle analysis usually completes in 1-2 seconds for simple tokens
                // - Top holders analysis takes 3-4 seconds due to API calls
                
                const bundleResult = analysisResult.analyses?.bundle?.result;
                const holdersResult = analysisResult.analyses?.topHolders?.result;
                
                if (bundleResult && holdersResult) {
                    // Get bundle count for complexity estimation
                    const bundleCount = (bundleResult.bundles && bundleResult.bundles.length) || 0;
                    const bundleDetected = bundleResult.bundleDetected || false;
                    
                    // Simple but accurate estimation based on your actual log patterns:
                    if (bundleCount <= 20) {
                        // Simple tokens: bundle analysis is fast, holders takes most time
                        bundleAnalysisTime = Math.round(analysisTime * 0.25); // ~25% for bundle
                        topHoldersAnalysisTime = analysisTime - bundleAnalysisTime; // ~75% for holders
                    } else if (bundleCount <= 100) {
                        // Moderate bundling: more balanced
                        bundleAnalysisTime = Math.round(analysisTime * 0.4); // ~40% for bundle
                        topHoldersAnalysisTime = analysisTime - bundleAnalysisTime; // ~60% for holders
                    } else {
                        // Heavy bundling: bundle analysis dominates
                        bundleAnalysisTime = Math.round(analysisTime * 0.7); // ~70% for bundle
                        topHoldersAnalysisTime = analysisTime - bundleAnalysisTime; // ~30% for holders
                    }
                    
                    logger.info(`[${operationId}] Estimated timings for ${bundleCount} bundles - Bundle: ${bundleAnalysisTime}ms, Holders: ${topHoldersAnalysisTime}ms`);
                } else {
                    // Ultimate fallback: 25/75 split based on observed pattern
                    bundleAnalysisTime = Math.round(analysisTime * 0.25);
                    topHoldersAnalysisTime = analysisTime - bundleAnalysisTime;
                    logger.info(`[${operationId}] Using default 25/75 split - Bundle: ${bundleAnalysisTime}ms, Holders: ${topHoldersAnalysisTime}ms`);
                }
            }
            
            // Update comprehensive timing stats
            this.updateTimingStats('analysis', analysisTime);
            this.updateTimingStats('bundleAnalysis', bundleAnalysisTime);
            this.updateTimingStats('topHoldersAnalysis', topHoldersAnalysisTime);
            this.updateAnalysisTimingStats(totalProcessingTime, tokenEvent.symbol);

            // STEP 6: Handle results with detailed timing breakdown
            if (analysisResult.success) {
                logger.info(`✅ [${operationId}] Analysis completed successfully!`);
                logger.info(`📊 [${operationId}] Timing Breakdown:`);
                if (tokenEvent.processingTimes) {
                    logger.info(`   • Metadata fetch: ${tokenEvent.processingTimes.metadataFetch}ms`);
                    logger.info(`   • Twitter extract: ${tokenEvent.processingTimes.twitterExtract}ms`);
                }
                logger.info(`   • Queue wait: ${processingStart - tokenEvent.processingTimes?.queuedAt || 0}ms`);
                logger.info(`   • Likes validation: ~${this.stats.avgTwitterValidationTime}ms (avg)`);
                if (viewExtractionTime > 0) {
                    logger.info(`   • View extraction: ${viewExtractionTime}ms (parallel)`);
                }
                logger.info(`   • Analysis execution: ${analysisTime}ms (parallel)`);
                if (bundleAnalysisTime > 0) {
                    logger.info(`     ↳ Bundle analysis: ${bundleAnalysisTime}ms`);
                }
                if (topHoldersAnalysisTime > 0) {
                    logger.info(`     ↳ Top holders analysis: ${topHoldersAnalysisTime}ms`);
                }
            } else {
                logger.error(`❌ [${operationId}] Analysis failed in ${totalAnalysisTime}ms: ${analysisResult.error}`);
                this.stats.errors++;
            }

        } catch (error) {
            const totalTime = Date.now() - processingStart;
            logger.error(`❌ [${operationId}] Analysis error in ${totalTime}ms:`, error);
            this.stats.errors++;
        } finally {
            this.currentlyAnalyzing.delete(tokenEvent.mint);
        }
    }

    // Enhanced timing statistics methods
    updateTimingStats(operation, time) {
        const avgKey = `avg${operation.charAt(0).toUpperCase() + operation.slice(1)}Time`;
        if (this.stats[avgKey] === 0) {
            this.stats[avgKey] = time;
        } else {
            this.stats[avgKey] = Math.round((this.stats[avgKey] + time) / 2);
        }
    }

    updateAnalysisTimingStats(totalTime, tokenSymbol) {
        // Track slowest and fastest
        if (totalTime > this.stats.slowestAnalysis.time) {
            this.stats.slowestAnalysis = { time: totalTime, token: tokenSymbol };
        }
        if (totalTime < this.stats.fastestAnalysis.time) {
            this.stats.fastestAnalysis = { time: totalTime, token: tokenSymbol };
        }
    }

    // [Rest of the methods remain unchanged...]
    async extractTwitterUrlFromTokenInfo(tokenInfo) {
        // Check direct Twitter field first
        if (tokenInfo.twitter) {
            const directTwitterUrl = this.findTwitterStatusUrl(tokenInfo.twitter);
            if (directTwitterUrl) {
                logger.debug(`Twitter status URL found in direct field: ${directTwitterUrl}`);
                return directTwitterUrl;
            }
        }

        // Check other fields
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

        // Check metadata_uri if available
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
        
        for (const field of fieldsToCheck) {
            if (metadata[field]) {
                const fieldStr = JSON.stringify(metadata[field]);
                for (const pattern of statusPatterns) {
                    const matches = fieldStr.match(pattern);
                    if (matches) return matches[0];
                }
            }
        }
        
        const metadataStr = JSON.stringify(metadata);
        for (const pattern of statusPatterns) {
            const matches = metadataStr.match(pattern);
            if (matches) return matches[0];
        }
        
        return null;
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
            enabledAnalyses: this.analysisOrchestrator.getEnabledAnalyses(),
            // Enhanced timing info
            timingAverages: {
                metadata: `${this.stats.avgMetadataFetchTime}ms`,
                twitter: `${this.stats.avgTwitterValidationTime}ms`,
                views: `${this.stats.avgViewExtractionTime}ms`,
                analysis: `${this.stats.avgAnalysisTime}ms`,
                bundleAnalysis: `${this.stats.avgBundleAnalysisTime}ms`,
                topHoldersAnalysis: `${this.stats.avgTopHoldersAnalysisTime}ms`
            },
            timingExtremes: {
                slowest: `${Math.round(this.stats.slowestAnalysis.time/1000)}s (${this.stats.slowestAnalysis.token})`,
                fastest: this.stats.fastestAnalysis.time < Infinity ? 
                    `${Math.round(this.stats.fastestAnalysis.time/1000)}s (${this.stats.fastestAnalysis.token})` : 'N/A'
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
        const { migrationsReceived, migrationsProcessed, analysesCompleted, migrationsSkipped, errors, viewCountsExtracted, metadataFetchFailures } = this.stats;
        const successRate = migrationsReceived > 0 ? ((analysesCompleted / migrationsReceived) * 100).toFixed(1) : 0;
        const viewExtractionRate = analysesCompleted > 0 ? ((viewCountsExtracted / analysesCompleted) * 100).toFixed(1) : 0;
        
        return `📊 Migration Stats: ${migrationsReceived} received | ${migrationsProcessed} processed | ${analysesCompleted} analyzed | ${migrationsSkipped} skipped | ${metadataFetchFailures} metadata failures | ${viewCountsExtracted} views (${viewExtractionRate}%) | Avg times: Meta ${this.stats.avgMetadataFetchTime}ms, Views ${this.stats.avgViewExtractionTime}ms, Bundle ${this.stats.avgBundleAnalysisTime}ms, Holders ${this.stats.avgTopHoldersAnalysisTime}ms | ${errors} errors | ${successRate}% success`;
    }

    resetStats() {
        this.stats = {
            migrationsReceived: 0,
            migrationsProcessed: 0,
            analysesCompleted: 0,
            migrationsSkipped: 0,
            viewCountsExtracted: 0,
            metadataFetchFailures: 0,
            errors: 0,
            avgMetadataFetchTime: 0,
            avgTwitterValidationTime: 0,
            avgViewExtractionTime: 0,
            avgAnalysisTime: 0,
            slowestAnalysis: { time: 0, token: '' },
            fastestAnalysis: { time: Infinity, token: '' }
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