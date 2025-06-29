// src/analysis/topHoldersAnalyzer.js - Complete rewrite using your getHolders
const { getSolanaApi } = require('../integrations/solanaApi');
const { getTopHolders } = require('../tools/getHolders'); // Your proven implementation
const { isFreshWallet } = require('../tools/freshWalletChecker');
const logger = require('../utils/logger');
const BigNumber = require('bignumber.js');

class TopHoldersAnalyzer {
    constructor() {
        this.solanaApi = getSolanaApi();
        this.HIGH_VALUE_THRESHOLD = 100000; // $100k USD threshold for whales
        this.FRESH_WALLET_TX_THRESHOLD = 50; // Less than 50 transactions = fresh wallet
        this.SOL_PRICE_ESTIMATE = 200; // Rough SOL price for USD calculations
    }

    async analyzeTopHolders(tokenAddress, count = 20) {
        try {
            logger.info(`Starting top holders analysis for ${tokenAddress} (top ${count})`);

            // Get token metadata first
            const tokenMetadata = await this.solanaApi.getAsset(tokenAddress);
            if (!tokenMetadata) {
                throw new Error("No token metadata found");
            }

            const tokenInfo = this.formatTokenInfo(tokenMetadata, tokenAddress);
            logger.debug('Token info retrieved:', { 
                symbol: tokenInfo.symbol, 
                decimals: tokenInfo.decimals, 
                supply: tokenInfo.total_supply 
            });

            // Use your proven getTopHolders function
            logger.debug('Fetching top holders using proven implementation...');
            const topHolders = await getTopHolders(tokenAddress, count, 'topHoldersAnalysis', 'fetchTopHolders');
            
            if (!topHolders || topHolders.length === 0) {
                logger.warn(`No holders found for token ${tokenAddress}`);
                return {
                    success: false,
                    error: "No holders found",
                    tokenInfo
                };
            }

            logger.info(`Successfully fetched ${topHolders.length} top holders for analysis`);

            // Analyze each holder with your proven data format
            const analysisResults = await this.analyzeHoldersWithYourData(topHolders, tokenAddress, tokenInfo);

            // Generate comprehensive summary
            const summary = this.generateComprehensiveSummary(analysisResults, tokenInfo);

            logger.info(`Top holders analysis completed for ${tokenAddress}:`, {
                totalHolders: analysisResults.length,
                whales: summary.whaleCount,
                freshWallets: summary.freshWalletCount,
                riskLevel: summary.riskLevel,
                riskScore: summary.riskScore
            });

            return {
                success: true,
                tokenInfo,
                holders: analysisResults,
                summary,
                totalAnalyzed: analysisResults.length
            };

        } catch (error) {
            logger.error(`Error in top holders analysis for ${tokenAddress}:`, error);
            return {
                success: false,
                error: error.message,
                tokenInfo: this.getBasicTokenInfo(tokenAddress)
            };
        }
    }

    async analyzeHoldersWithYourData(holders, tokenAddress, tokenInfo) {
        logger.debug(`Analyzing ${holders.length} holders individually...`);
        const results = [];
        const batchSize = 5; // Process in small batches to avoid rate limits

        for (let i = 0; i < holders.length; i += batchSize) {
            const batch = holders.slice(i, i + batchSize);
            
            const batchPromises = batch.map(async (holder, batchIndex) => {
                const holderIndex = i + batchIndex + 1;
                try {
                    logger.debug(`Analyzing holder ${holderIndex}/${holders.length}: ${holder.address}`);
                    return await this.analyzeIndividualHolderWithYourData(holder, tokenAddress, tokenInfo);
                } catch (error) {
                    logger.warn(`Error analyzing holder ${holder.address}:`, error.message);
                    return this.createErrorHolderResult(holder, error.message);
                }
            });

            const batchResults = await Promise.allSettled(batchPromises);
            
            batchResults.forEach((result) => {
                if (result.status === 'fulfilled') {
                    results.push(result.value);
                } else {
                    logger.warn('Batch analysis failed:', result.reason);
                }
            });

            // Small delay between batches
            if (i + batchSize < holders.length) {
                await new Promise(resolve => setTimeout(resolve, 200));
            }
        }

        logger.debug(`Completed analysis of ${results.length} holders`);
        return results;
    }

    async analyzeIndividualHolderWithYourData(holder, tokenAddress, tokenInfo) {
        const address = holder.address;
        
        // Your getHolders already provides excellent balance data
        const tokenBalance = new BigNumber(holder.tokenBalance || holder.balance || 0);
        const solBalance = parseFloat(holder.solBalance || 0);
        
        // Calculate holding percentage using your data
        const totalSupply = new BigNumber(tokenInfo.total_supply || 1000000000);
        const holdingPercentage = tokenBalance.dividedBy(totalSupply).multipliedBy(100);

        // Estimate USD values
        const solValueUsd = solBalance * this.SOL_PRICE_ESTIMATE;
        const tokenValueUsd = this.estimateTokenValue(tokenBalance, tokenInfo);

        // Check if wallet is fresh (low transaction count)
        let isFresh = false;
        let transactionCount = 0;
        
        try {
            // Use your fresh wallet checker if available, otherwise get signatures
            if (typeof isFreshWallet === 'function') {
                isFresh = await isFreshWallet(address, null, 'topHoldersAnalysis', 'freshCheck');
            } else {
                const signatures = await this.getWalletSignatures(address);
                transactionCount = signatures.length;
                isFresh = transactionCount <= this.FRESH_WALLET_TX_THRESHOLD;
            }
        } catch (error) {
            logger.debug(`Could not determine fresh status for ${address}: ${error.message}`);
            // Default to not fresh if we can't determine
            isFresh = false;
        }

        // Determine if wallet is a whale based on SOL holdings
        const isWhale = solValueUsd >= this.HIGH_VALUE_THRESHOLD;

        // Categorize the wallet
        const category = this.categorizeWallet(isWhale, isFresh, solValueUsd);

        return {
            address,
            balance: tokenBalance.toString(),
            holdingPercentage: holdingPercentage.toFixed(4),
            solBalance: solBalance.toFixed(4),
            solValueUsd: solValueUsd,
            tokenValueUsd: tokenValueUsd,
            transactionCount: transactionCount,
            isWhale,
            isFresh,
            category,
            analysis: {
                estimatedTotalValue: solValueUsd + tokenValueUsd,
                riskFlags: this.generateHolderRiskFlags(isWhale, isFresh, holdingPercentage.toNumber()),
                confidence: this.calculateAnalysisConfidence(solBalance, transactionCount)
            }
        };
    }

    async getWalletSignatures(address) {
        try {
            const signatures = await this.solanaApi.getSignaturesForAddress(
                address, 
                { limit: this.FRESH_WALLET_TX_THRESHOLD + 1 }
            );
            return signatures || [];
        } catch (error) {
            logger.debug(`Error getting signatures for ${address}:`, error.message);
            return [];
        }
    }

    categorizeWallet(isWhale, isFresh, usdValue) {
        if (isWhale) return 'Whale';
        if (isFresh) return 'Fresh';
        if (usdValue > 10000) return 'High Value'; // $10k+ but not whale level
        return 'Regular';
    }

    generateHolderRiskFlags(isWhale, isFresh, holdingPercentage) {
        const flags = [];
        
        if (isFresh && holdingPercentage > 1) {
            flags.push('Fresh wallet with significant holdings');
        }
        
        if (holdingPercentage > 5) {
            flags.push('Large supply concentration');
        }
        
        if (isWhale && holdingPercentage > 2) {
            flags.push('Whale with concentrated position');
        }
        
        return flags;
    }

    calculateAnalysisConfidence(solBalance, transactionCount) {
        let confidence = 100;
        
        // Lower confidence if we couldn't get transaction data
        if (transactionCount === 0) confidence -= 20;
        
        // Lower confidence for very low SOL balance (might be inactive)
        if (solBalance < 0.001) confidence -= 15;
        
        return Math.max(confidence, 50); // Minimum 50% confidence
    }

    estimateTokenValue(tokenBalance, tokenInfo) {
        // Simple estimation - in reality you'd want real price data
        const price = tokenInfo.price || 0;
        return tokenBalance.multipliedBy(price).toNumber();
    }

    generateComprehensiveSummary(analysisResults, tokenInfo) {
        const totalHolders = analysisResults.length;
        const whaleCount = analysisResults.filter(h => h.isWhale).length;
        const freshWalletCount = analysisResults.filter(h => h.isFresh).length;
        const highValueCount = analysisResults.filter(h => h.category === 'High Value').length;
        const regularWalletCount = totalHolders - whaleCount - freshWalletCount - highValueCount;

        // Calculate concentration metrics using your proven data
        const holdingPercentages = analysisResults.map(h => parseFloat(h.holdingPercentage || 0));
        const top5Holdings = holdingPercentages.slice(0, 5).reduce((sum, pct) => sum + pct, 0);
        const top10Holdings = holdingPercentages.slice(0, 10).reduce((sum, pct) => sum + pct, 0);
        const top20Holdings = holdingPercentages.reduce((sum, pct) => sum + pct, 0);

        // Calculate token percentages held by whales and fresh wallets
        const whaleTokenPercentage = analysisResults
        .filter(h => h.isWhale)
        .reduce((sum, h) => sum + parseFloat(h.holdingPercentage || 0), 0);

        const freshWalletTokenPercentage = analysisResults
            .filter(h => h.isFresh)
            .reduce((sum, h) => sum + parseFloat(h.holdingPercentage || 0), 0);

        // Advanced risk assessment
        const riskScore = this.calculateAdvancedRiskScore(
            whaleCount, 
            freshWalletCount, 
            top5Holdings, 
            top10Holdings,
            analysisResults
        );
        
        const riskLevel = this.determineRiskLevel(riskScore);
        const riskFlags = this.generateSummaryRiskFlags(
            whaleCount, 
            freshWalletCount, 
            top5Holdings, 
            top10Holdings
        );

        return {
            totalHolders,
            whaleCount,
            freshWalletCount,
            highValueCount,
            regularWalletCount,
            whalePercentage: ((whaleCount / totalHolders) * 100).toFixed(1),
            freshWalletPercentage: ((freshWalletCount / totalHolders) * 100).toFixed(1), 
            whaleTokenPercentage: whaleTokenPercentage.toFixed(2), 
            freshWalletTokenPercentage: freshWalletTokenPercentage.toFixed(2), 
            whalePercentage: ((whaleCount / totalHolders) * 100).toFixed(1),
            freshWalletPercentage: ((freshWalletCount / totalHolders) * 100).toFixed(1),
            concentration: {
                top5Percentage: top5Holdings.toFixed(2),
                top10Percentage: top10Holdings.toFixed(2),
                top20Percentage: top20Holdings.toFixed(2)
            },
            riskScore,
            riskLevel,
            flags: riskFlags,
            insights: this.generateInsights(analysisResults, top5Holdings)
        };
    }

    calculateAdvancedRiskScore(whaleCount, freshWalletCount, top5Holdings, top10Holdings, holders) {
        let score = 100; // Start with perfect score

        // Penalize for too many fresh wallets
        if (freshWalletCount > 12) score -= 35;
        else if (freshWalletCount > 8) score -= 20;
        else if (freshWalletCount > 5) score -= 10;

        // Penalize for too many whales
        if (whaleCount > 10) score -= 25;
        else if (whaleCount > 6) score -= 15;
        else if (whaleCount > 3) score -= 5;

        // Heavy penalty for extreme concentration
        if (top5Holdings > 90) score -= 50;
        else if (top5Holdings > 80) score -= 40;
        else if (top5Holdings > 70) score -= 30;
        else if (top5Holdings > 60) score -= 20;
        else if (top5Holdings > 50) score -= 10;

        // Additional penalty for top 10 concentration
        if (top10Holdings > 95) score -= 20;
        else if (top10Holdings > 85) score -= 10;

        // Bonus for good distribution
        if (freshWalletCount <= 3 && whaleCount <= 3 && top5Holdings < 40) {
            score += 10;
        }

        return Math.max(0, Math.min(100, score));
    }

    determineRiskLevel(score) {
        if (score >= 85) return 'LOW';
        if (score >= 70) return 'MEDIUM';
        if (score >= 50) return 'HIGH';
        return 'VERY_HIGH';
    }

    generateSummaryRiskFlags(whaleCount, freshWalletCount, top5Holdings, top10Holdings) {
        const flags = [];

        if (freshWalletCount > 12) {
            flags.push(`🔴 Very high fresh wallet count: ${freshWalletCount}/20`);
        } else if (freshWalletCount > 8) {
            flags.push(`🟠 High fresh wallet count: ${freshWalletCount}/20`);
        } else if (freshWalletCount > 5) {
            flags.push(`🟡 Moderate fresh wallet count: ${freshWalletCount}/20`);
        }

        if (whaleCount > 10) {
            flags.push(`🔴 Very high whale concentration: ${whaleCount}/20`);
        } else if (whaleCount > 6) {
            flags.push(`🟠 High whale concentration: ${whaleCount}/20`);
        } else if (whaleCount > 3) {
            flags.push(`🟡 Moderate whale presence: ${whaleCount}/20`);
        }

        if (top5Holdings > 90) {
            flags.push(`🔴 Extreme concentration: Top 5 hold ${top5Holdings.toFixed(1)}%`);
        } else if (top5Holdings > 80) {
            flags.push(`🔴 Very high concentration: Top 5 hold ${top5Holdings.toFixed(1)}%`);
        } else if (top5Holdings > 70) {
            flags.push(`🟠 High concentration: Top 5 hold ${top5Holdings.toFixed(1)}%`);
        } else if (top5Holdings > 60) {
            flags.push(`🟡 Moderate concentration: Top 5 hold ${top5Holdings.toFixed(1)}%`);
        }

        if (flags.length === 0) {
            flags.push('✅ Healthy holder distribution detected');
        }

        return flags;
    }

    generateInsights(holders, top5Holdings) {
        const insights = [];
        
        const avgHolding = holders.reduce((sum, h) => sum + parseFloat(h.holdingPercentage), 0) / holders.length;
        if (avgHolding > 2) {
            insights.push('High average holding percentage suggests concentrated ownership');
        }
        
        const whalesWithLargeHoldings = holders.filter(h => h.isWhale && parseFloat(h.holdingPercentage) > 3).length;
        if (whalesWithLargeHoldings > 0) {
            insights.push(`${whalesWithLargeHoldings} whale(s) hold significant portions of supply`);
        }
        
        const freshWithLargeHoldings = holders.filter(h => h.isFresh && parseFloat(h.holdingPercentage) > 1).length;
        if (freshWithLargeHoldings > 3) {
            insights.push('Multiple fresh wallets with substantial holdings - potential coordination');
        }
        
        return insights;
    }

    createErrorHolderResult(holder, errorMessage) {
        return {
            address: holder.address,
            error: errorMessage,
            isWhale: false,
            isFresh: false,
            balance: holder.balance || 0,
            category: 'Error',
            analysis: {
                confidence: 0
            }
        };
    }

    formatTokenInfo(tokenMetadata, tokenAddress) {
        return {
            decimals: tokenMetadata.decimals || 6,
            symbol: tokenMetadata.symbol || 'Unknown',
            name: tokenMetadata.name || 'Unknown Token',
            address: tokenAddress,
            price: tokenMetadata.price || 0,
            total_supply: tokenMetadata.supply?.total || 1000000000,
            market_cap: (tokenMetadata.price || 0) * (tokenMetadata.supply?.total || 1000000000)
        };
    }

    getBasicTokenInfo(tokenAddress) {
        return {
            decimals: 6,
            symbol: 'Unknown',
            name: 'Unknown Token',
            address: tokenAddress,
            price: 0,
            total_supply: 1000000000,
            market_cap: 0
        };
    }
}

module.exports = TopHoldersAnalyzer;