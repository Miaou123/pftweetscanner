// src/orchestrators/analysisOrchestrator.js
const logger = require('../utils/logger');
const UnifiedBundleAnalyzer = require('../analysis/bundle');
const { analyzeBestTraders } = require('../analysis/bestTraders');
const { analyzeTeamSupply } = require('../analysis/teamSupply');
const { analyzeFreshWallets } = require('../analysis/freshWallets');
const { scanToken } = require('../analysis/topHoldersScanner');
const DevAnalyzer = require('../analysis/devAnalyzer');
const TelegramPublisher = require('../publishers/telegramPublisher');

class AnalysisOrchestrator {
    constructor(config = {}) {
        this.config = {
            analysisTimeout: config.analysisTimeout || 5 * 60 * 1000, // 5 minutes
            enabledAnalyses: config.enabledAnalyses || [
                'bundle',
                'topHolders', 
                'devAnalysis',
                'teamSupply',
                'freshWallets'
            ],
            publishResults: config.publishResults !== false,
            minHoldersForAnalysis: config.minHoldersForAnalysis || 20,
            ...config
        };

        this.bundleAnalyzer = new UnifiedBundleAnalyzer();
        this.devAnalyzer = DevAnalyzer;
        this.telegramPublisher = new TelegramPublisher(config.telegram || {});
        
        // Analysis state
        this.activeAnalyses = new Map();
        this.completedAnalyses = new Map();
    }

    async analyzeToken(tokenData) {
        const { tokenAddress, tokenInfo, twitterMetrics, operationId } = tokenData;
        
        logger.info(`🔬 [${operationId}] Starting comprehensive analysis for ${tokenInfo.symbol} (${tokenAddress})`);
        
        const analysisResult = {
            tokenAddress,
            tokenInfo,
            twitterMetrics,
            operationId,
            startTime: Date.now(),
            success: false,
            analyses: {},
            errors: [],
            summary: {}
        };

        // Create cancellation token for timeout handling
        const cancellationToken = this.createCancellationToken(this.config.analysisTimeout);
        this.activeAnalyses.set(operationId, cancellationToken);

        try {
            // Run analyses in parallel with timeout
            const analysisPromises = this.createAnalysisPromises(
                tokenAddress, 
                tokenInfo, 
                operationId, 
                cancellationToken
            );

            const results = await Promise.allSettled(analysisPromises);
            
            // Process results
            this.processAnalysisResults(results, analysisResult);
            
            // Generate summary
            this.generateAnalysisSummary(analysisResult);
            
            // Determine if analysis was successful
            analysisResult.success = this.hasMinimumSuccessfulAnalyses(analysisResult);
            analysisResult.endTime = Date.now();
            analysisResult.duration = analysisResult.endTime - analysisResult.startTime;

            if (analysisResult.success) {
                logger.info(`✅ [${operationId}] Analysis completed successfully in ${analysisResult.duration}ms`);
                
                // Publish results if enabled
                if (this.config.publishResults) {
                    await this.publishResults(analysisResult);
                }
            } else {
                logger.warn(`⚠️ [${operationId}] Analysis completed with limited success`);
            }

            return analysisResult;

        } catch (error) {
            logger.error(`❌ [${operationId}] Analysis failed:`, error);
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

    createAnalysisPromises(tokenAddress, tokenInfo, operationId, cancellationToken) {
        const promises = [];

        // Bundle Analysis
        if (this.config.enabledAnalyses.includes('bundle')) {
            promises.push(
                this.runAnalysisWithTimeout(
                    'bundle',
                    () => this.bundleAnalyzer.analyzeBundle(tokenAddress, 50000, false),
                    operationId,
                    cancellationToken
                )
            );
        }

        // Top Holders Analysis
        if (this.config.enabledAnalyses.includes('topHolders')) {
            promises.push(
                this.runAnalysisWithTimeout(
                    'topHolders',
                    () => scanToken(tokenAddress, this.config.minHoldersForAnalysis, false, operationId),
                    operationId,
                    cancellationToken
                )
            );
        }

        // Dev Analysis
        if (this.config.enabledAnalyses.includes('devAnalysis')) {
            promises.push(
                this.runAnalysisWithTimeout(
                    'devAnalysis',
                    () => this.devAnalyzer.analyzeDevProfile(tokenAddress),
                    operationId,
                    cancellationToken
                )
            );
        }

        // Team Supply Analysis
        if (this.config.enabledAnalyses.includes('teamSupply')) {
            promises.push(
                this.runAnalysisWithTimeout(
                    'teamSupply',
                    () => analyzeTeamSupply(tokenAddress, operationId, cancellationToken),
                    operationId,
                    cancellationToken
                )
            );
        }

        // Fresh Wallets Analysis
        if (this.config.enabledAnalyses.includes('freshWallets')) {
            promises.push(
                this.runAnalysisWithTimeout(
                    'freshWallets',
                    () => analyzeFreshWallets(tokenAddress, operationId),
                    operationId,
                    cancellationToken
                )
            );
        }

        return promises;
    }

    async runAnalysisWithTimeout(analysisType, analysisFunction, operationId, cancellationToken) {
        const startTime = Date.now();
        logger.debug(`[${operationId}] Starting ${analysisType} analysis`);

        try {
            // Create timeout promise
            const timeoutPromise = new Promise((_, reject) => {
                const timeoutId = setTimeout(() => {
                    reject(new Error(`${analysisType} analysis timed out`));
                }, this.config.analysisTimeout);

                // Clear timeout if cancellation token is triggered
                cancellationToken.onCancel(() => {
                    clearTimeout(timeoutId);
                    reject(new Error(`${analysisType} analysis cancelled`));
                });
            });

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

    processAnalysisResults(results, analysisResult) {
        results.forEach((promiseResult, index) => {
            if (promiseResult.status === 'fulfilled') {
                const analysis = promiseResult.value;
                analysisResult.analyses[analysis.type] = analysis;
                
                if (!analysis.success) {
                    analysisResult.errors.push(`${analysis.type}: ${analysis.error}`);
                }
            } else {
                analysisResult.errors.push(`Analysis ${index} rejected: ${promiseResult.reason.message}`);
            }
        });
    }

    generateAnalysisSummary(analysisResult) {
        const summary = {
            totalAnalyses: Object.keys(analysisResult.analyses).length,
            successfulAnalyses: 0,
            failedAnalyses: 0,
            flags: [],
            scores: {}
        };

        // Count successes and failures
        Object.values(analysisResult.analyses).forEach(analysis => {
            if (analysis.success) {
                summary.successfulAnalyses++;
                this.addAnalysisFlags(analysis, summary.flags);
                this.calculateAnalysisScore(analysis, summary.scores);
            } else {
                summary.failedAnalyses++;
            }
        });

        // Calculate overall risk score
        summary.overallScore = this.calculateOverallScore(summary.scores);
        summary.riskLevel = this.determineRiskLevel(summary.overallScore);

        analysisResult.summary = summary;
    }

    addAnalysisFlags(analysis, flags) {
        const { type, result } = analysis;

        switch (type) {
            case 'bundle':
                if (result?.bundleDetected) {
                    flags.push(`🔴 Bundle detected: ${result.percentageBundled?.toFixed(2)}% of supply`);
                }
                break;

            case 'teamSupply':
                if (result?.scanData?.totalSupplyControlled > 30) {
                    flags.push(`⚠️ Team controls ${result.scanData.totalSupplyControlled.toFixed(2)}% of supply`);
                }
                break;

            case 'freshWallets':
                if (result?.scanData?.totalSupplyControlled > 20) {
                    flags.push(`🆕 Fresh wallets hold ${result.scanData.totalSupplyControlled.toFixed(2)}% of supply`);
                }
                break;

            case 'topHolders':
                if (result?.totalSupplyControlled > 50) {
                    flags.push(`📊 Top holders control ${result.totalSupplyControlled.toFixed(2)}% of supply`);
                }
                break;

            case 'devAnalysis':
                if (result?.success && result.coinsStats?.bondedPercentage) {
                    const bondedPercent = parseFloat(result.coinsStats.bondedPercentage);
                    if (bondedPercent > 50) {
                        flags.push(`👨‍💻 Dev has ${bondedPercent}% success rate (${result.coinsStats.bondedCount}/${result.coinsStats.totalCoins})`);
                    }
                }
                break;
        }
    }

    calculateAnalysisScore(analysis, scores) {
        const { type, result } = analysis;

        switch (type) {
            case 'bundle':
                scores.bundle = result?.bundleDetected ? 0 : 100;
                break;

            case 'teamSupply':
                const teamControl = result?.scanData?.totalSupplyControlled || 0;
                scores.teamSupply = Math.max(0, 100 - (teamControl * 2)); // 50% team = 0 score
                break;

            case 'freshWallets':
                const freshControl = result?.scanData?.totalSupplyControlled || 0;
                scores.freshWallets = Math.max(0, 100 - (freshControl * 3)); // 33% fresh = 0 score
                break;

            case 'topHolders':
                const holderControl = result?.totalSupplyControlled || 0;
                scores.topHolders = Math.max(0, 100 - (holderControl * 1.5)); // 66% holders = 0 score
                break;

            case 'devAnalysis':
                if (result?.success && result.coinsStats?.bondedPercentage) {
                    const bondedPercent = parseFloat(result.coinsStats.bondedPercentage);
                    scores.devAnalysis = Math.min(100, bondedPercent * 2); // 50% success = 100 score
                }
                break;
        }
    }

    calculateOverallScore(scores) {
        const values = Object.values(scores).filter(score => typeof score === 'number');
        if (values.length === 0) return 0;
        
        return values.reduce((sum, score) => sum + score, 0) / values.length;
    }

    determineRiskLevel(score) {
        if (score >= 80) return 'LOW';
        if (score >= 60) return 'MEDIUM';
        if (score >= 40) return 'HIGH';
        return 'VERY_HIGH';
    }

    hasMinimumSuccessfulAnalyses(analysisResult) {
        const successfulCount = Object.values(analysisResult.analyses)
            .filter(analysis => analysis.success).length;
        
        return successfulCount >= 2; // At least 2 successful analyses
    }

    async publishResults(analysisResult) {
        try {
            logger.info(`📤 [${analysisResult.operationId}] Publishing analysis results`);
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
            activeAnalyses: this.activeAnalyses.size,
            completedAnalyses: this.completedAnalyses.size,
            enabledAnalyses: this.config.enabledAnalyses,
            config: {
                analysisTimeout: this.config.analysisTimeout,
                publishResults: this.config.publishResults,
                minHoldersForAnalysis: this.config.minHoldersForAnalysis
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
            logger.info(`Cancelled analysis ${operationId}`);
            return true;
        }
        return false;
    }
}

module.exports = AnalysisOrchestrator;