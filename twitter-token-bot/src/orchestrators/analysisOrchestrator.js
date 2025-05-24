// src/orchestrators/analysisOrchestrator.js - Updated with configurable analyses
const logger = require('../utils/logger');
const BundleAnalyzer = require('../analysis/bundleAnalyzer');
const TelegramPublisher = require('../publishers/telegramPublisher');
const analysisConfig = require('../config/analysisConfig');

class AnalysisOrchestrator {
    constructor(config = {}) {
        this.botType = config.botType || 'creation'; // 'creation' or 'migration'
        this.config = {
            publishResults: config.publishResults !== false,
            telegram: config.telegram || {},
            ...config
        };

        // Get bot-specific analysis configuration
        this.analysisConfig = analysisConfig.getConfigForBot(this.botType);
        
        logger.info(`🔬 Analysis Orchestrator initialized for ${this.botType} bot`);
        logger.info(`   • Enabled analyses: ${this.analysisConfig.enabledAnalyses.join(', ')}`);
        logger.info(`   • Timeout: ${this.analysisConfig.timeout / 1000}s`);
        logger.info(`   • Max concurrent: ${this.analysisConfig.maxConcurrent}`);

        // Initialize analyzers (we'll add more as we create them)
        this.analyzers = {
            bundle: BundleAnalyzer,
            // topHolders: TopHoldersAnalyzer,     // To be implemented
            // freshWallets: FreshWalletAnalyzer,  // To be implemented
            // devAnalysis: DevAnalyzer,           // To be implemented
            // teamSupply: TeamSupplyAnalyzer,     // To be implemented
        };

        this.telegramPublisher = new TelegramPublisher(this.config.telegram);
        
        // Analysis state
        this.activeAnalyses = new Map();
        this.completedAnalyses = new Map();
    }

    async analyzeToken(tokenData) {
        const { tokenAddress, tokenInfo, twitterMetrics, operationId } = tokenData;
        
        logger.info(`🔬 [${operationId}] Starting ${this.botType} analysis for ${tokenInfo.symbol} (${tokenAddress})`);
        logger.debug(`[${operationId}] Enabled analyses: ${this.analysisConfig.enabledAnalyses.join(', ')}`);
        
        const analysisResult = {
            tokenAddress,
            tokenInfo,
            twitterMetrics,
            operationId,
            botType: this.botType,
            startTime: Date.now(),
            success: false,
            analyses: {},
            errors: [],
            summary: {}
        };

        // Create cancellation token for timeout handling
        const cancellationToken = this.createCancellationToken(this.analysisConfig.timeout);
        this.activeAnalyses.set(operationId, cancellationToken);

        try {
            // Run enabled analyses
            const analysisPromises = this.analysisConfig.enabledAnalyses.map(analysisType => 
                this.runSingleAnalysis(analysisType, tokenAddress, operationId, cancellationToken)
            );

            const analysisResults = await Promise.allSettled(analysisPromises);

            // Process results
            let successfulAnalyses = 0;
            analysisResults.forEach((result, index) => {
                const analysisType = this.analysisConfig.enabledAnalyses[index];
                
                if (result.status === 'fulfilled') {
                    analysisResult.analyses[analysisType] = result.value;
                    if (result.value.success) {
                        successfulAnalyses++;
                    } else {
                        analysisResult.errors.push(`${analysisType}: ${result.value.error}`);
                    }
                } else {
                    analysisResult.analyses[analysisType] = {
                        type: analysisType,
                        success: false,
                        result: null,
                        error: result.reason.message,
                        duration: 0
                    };
                    analysisResult.errors.push(`${analysisType}: ${result.reason.message}`);
                }
            });
            
            // Generate summary
            this.generateAnalysisSummary(analysisResult);
            
            // Determine if analysis was successful (at least one analysis succeeded)
            analysisResult.success = successfulAnalyses > 0;
            analysisResult.endTime = Date.now();
            analysisResult.duration = analysisResult.endTime - analysisResult.startTime;

            if (analysisResult.success) {
                logger.info(`✅ [${operationId}] ${this.botType} analysis completed successfully in ${analysisResult.duration}ms`);
                logger.info(`   • Successful analyses: ${successfulAnalyses}/${this.analysisConfig.enabledAnalyses.length}`);
                
                // Publish results if enabled
                if (this.config.publishResults) {
                    await this.publishResults(analysisResult);
                }
            } else {
                logger.warn(`⚠️ [${operationId}] ${this.botType} analysis failed - no successful analyses`);
            }

            return analysisResult;

        } catch (error) {
            logger.error(`❌ [${operationId}] ${this.botType} analysis failed:`, error);
            analysisResult.error = error.message;
            analysisResult.endTime = Date.now();
            analysisResult.duration = analysisResult.endTime - analysisResult.startTime;
            
            return analysisResult;
        } finally {
            this.activeAnalyses.delete(operationId);
            this.completedAnalyses.set(operationId, analysisResult);
            
            // Clean up old completed analyses
            this.cleanupCompletedAnalyses();
        }
    }

    async runSingleAnalysis(analysisType, tokenAddress, operationId, cancellationToken) {
        const startTime = Date.now();
        logger.debug(`[${operationId}] Starting ${analysisType} analysis`);

        try {
            // Check if analyzer exists
            if (!this.analyzers[analysisType]) {
                throw new Error(`Analyzer not implemented: ${analysisType}`);
            }

            // Get analysis-specific thresholds
            const thresholds = analysisConfig.getAnalysisThresholds(this.botType, analysisType);
            
            // Create timeout promise
            const timeoutPromise = new Promise((_, reject) => {
                const timeoutId = setTimeout(() => {
                    reject(new Error(`${analysisType} analysis timed out`));
                }, this.analysisConfig.timeout);

                // Clear timeout if cancellation token is triggered
                cancellationToken.onCancel(() => {
                    clearTimeout(timeoutId);
                    reject(new Error(`${analysisType} analysis cancelled`));
                });
            });

            // Run the specific analysis with thresholds
            let analysisFunction;
            
            switch (analysisType) {
                case 'bundle':
                    analysisFunction = () => this.analyzers.bundle.analyzeBundle(tokenAddress, 50000);
                    break;
                case 'topHolders':
                    // analysisFunction = () => this.analyzers.topHolders.analyzeTopHolders(tokenAddress, thresholds);
                    throw new Error('Top holders analysis not yet implemented');
                case 'freshWallets':
                    // analysisFunction = () => this.analyzers.freshWallets.analyzeFreshWallets(tokenAddress, thresholds);
                    throw new Error('Fresh wallets analysis not yet implemented');
                case 'devAnalysis':
                    // analysisFunction = () => this.analyzers.devAnalysis.analyzeDevActivity(tokenAddress, thresholds);
                    throw new Error('Dev analysis not yet implemented');
                case 'teamSupply':
                    // analysisFunction = () => this.analyzers.teamSupply.analyzeTeamSupply(tokenAddress, thresholds);
                    throw new Error('Team supply analysis not yet implemented');
                default:
                    throw new Error(`Unknown analysis type: ${analysisType}`);
            }

            // Race between analysis and timeout
            const result = await Promise.race([
                analysisFunction(),
                timeoutPromise
            ]);

            const duration = Date.now() - startTime;
            logger.debug(`[${operationId}] ${analysisType} analysis completed in ${duration}ms`);

            return {
                type: analysisType,
                success: true,
                result,
                duration,
                error: null
            };

        } catch (error) {
            const duration = Date.now() - startTime;
            logger.warn(`[${operationId}] ${analysisType} analysis failed after ${duration}ms:`, error.message);

            return {
                type: analysisType,
                success: false,
                result: null,
                duration,
                error: error.message
            };
        }
    }

    generateAnalysisSummary(analysisResult) {
        const analyses = analysisResult.analyses;
        const enabledAnalyses = this.analysisConfig.enabledAnalyses;
        
        const summary = {
            botType: this.botType,
            totalAnalyses: enabledAnalyses.length,
            successfulAnalyses: 0,
            failedAnalyses: 0,
            flags: [],
            scores: {},
            enabledAnalyses: enabledAnalyses
        };

        // Process each analysis result
        enabledAnalyses.forEach(analysisType => {
            const analysis = analyses[analysisType];
            
            if (analysis && analysis.success) {
                summary.successfulAnalyses++;
                
                // Add type-specific flags and scores
                switch (analysisType) {
                    case 'bundle':
                        this.processBundleResults(analysis.result, summary);
                        break;
                    case 'topHolders':
                        // this.processTopHoldersResults(analysis.result, summary);
                        break;
                    case 'freshWallets':
                        // this.processFreshWalletsResults(analysis.result, summary);
                        break;
                    // Add more cases as we implement more analyses
                }
            } else {
                summary.failedAnalyses++;
            }
        });

        // Calculate overall score (average of successful analyses)
        const scores = Object.values(summary.scores);
        summary.overallScore = scores.length > 0 ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0;
        summary.riskLevel = this.determineRiskLevel(summary.overallScore);

        analysisResult.summary = summary;
    }

    processBundleResults(bundleResult, summary) {
        if (bundleResult && bundleResult.bundleDetected) {
            summary.flags.push(`🔴 Bundle detected: ${bundleResult.percentageBundled?.toFixed(2)}% of supply`);
            summary.scores.bundle = Math.max(0, 100 - bundleResult.percentageBundled * 2); // Lower score for more bundling
        } else {
            summary.scores.bundle = 100; // Perfect score if no bundling
        }
    }

    determineRiskLevel(score) {
        if (score >= 80) return 'LOW';
        if (score >= 60) return 'MEDIUM';
        if (score >= 40) return 'HIGH';
        return 'VERY_HIGH';
    }

    async publishResults(analysisResult) {
        try {
            logger.info(`📤 [${analysisResult.operationId}] Publishing ${this.botType} analysis results`);
            await this.telegramPublisher.publishAnalysis(analysisResult);
        } catch (error) {
            logger.error(`Failed to publish results for ${analysisResult.operationId}:`, error);
        }
    }

    createCancellationToken(timeout) {
        const token = {
            cancelled: false,
            callbacks: []
        };

        token.cancel = () => {
            token.cancelled = true;
            token.callbacks.forEach(callback => callback());
        };

        token.isCancelled = () => token.cancelled;

        token.onCancel = (callback) => {
            if (token.cancelled) {
                callback();
            } else {
                token.callbacks.push(callback);
            }
        };

        // Auto-cancel after timeout
        setTimeout(() => {
            if (!token.cancelled) {
                logger.warn(`Analysis timed out after ${timeout}ms`);
                token.cancel();
            }
        }, timeout);

        return token;
    }

    cleanupCompletedAnalyses() {
        // Keep only last 100 completed analyses
        if (this.completedAnalyses.size > 100) {
            const entries = Array.from(this.completedAnalyses.entries());
            const toDelete = entries.slice(0, entries.length - 100);
            
            toDelete.forEach(([operationId]) => {
                this.completedAnalyses.delete(operationId);
            });

            logger.debug(`Cleaned up ${toDelete.length} old analysis results`);
        }
    }

    getStatus() {
        return {
            botType: this.botType,
            activeAnalyses: this.activeAnalyses.size,
            completedAnalyses: this.completedAnalyses.size,
            enabledAnalyses: this.analysisConfig.enabledAnalyses,
            config: {
                timeout: this.analysisConfig.timeout,
                maxConcurrent: this.analysisConfig.maxConcurrent,
                publishResults: this.config.publishResults
            }
        };
    }

    // Get analysis result by operation ID
    getAnalysisResult(operationId) {
        return this.completedAnalyses.get(operationId);
    }

    // Cancel active analysis
    cancelAnalysis(operationId) {
        const cancellationToken = this.activeAnalyses.get(operationId);
        if (cancellationToken) {
            cancellationToken.cancel();
            logger.info(`Cancelled ${this.botType} analysis ${operationId}`);
            return true;
        }
        return false;
    }

    // Check if specific analysis is enabled
    isAnalysisEnabled(analysisType) {
        return this.analysisConfig.enabledAnalyses.includes(analysisType);
    }

    // Get enabled analyses list
    getEnabledAnalyses() {
        return [...this.analysisConfig.enabledAnalyses];
    }
}

module.exports = AnalysisOrchestrator;