// src/analysis/bundleAnalyzer.js
const pumpfunApi = require('../integrations/pumpfunApi');
const { getSolanaApi } = require('../integrations/solanaApi');
const logger = require('../utils/logger');
const BigNumber = require('bignumber.js');

class BundleAnalyzer {
    constructor() {
        this.logger = logger;
        this.TOKEN_DECIMALS = 6; // PumpFun standard decimals
        this.SOL_DECIMALS = 9;
        this.TOKEN_FACTOR = Math.pow(10, this.TOKEN_DECIMALS);
        this.SOL_FACTOR = Math.pow(10, this.SOL_DECIMALS);
    }

    async analyzeBundle(tokenAddress, limit = 50000) {
        try {
            logger.info(`Starting bundle analysis for token: ${tokenAddress}`);
            
            // Check if this is a PumpFun token
            const isPumpfun = await this.isPumpfunToken(tokenAddress);
            if (!isPumpfun) {
                logger.info(`Token ${tokenAddress} is not a PumpFun token, skipping bundle analysis`);
                return {
                    success: false,
                    error: 'Not a PumpFun token',
                    bundleDetected: false
                };
            }

            // Get token info
            const tokenInfo = await this.getTokenInfo(tokenAddress);
            
            // Fetch all trades for the token
            const allTrades = await this.fetchAllTrades(tokenAddress, limit);
            
            if (!allTrades || allTrades.length === 0) {
                return {
                    success: true,
                    bundleDetected: false,
                    totalTrades: 0,
                    tokenInfo
                };
            }

            // Analyze trades for bundles
            const bundleAnalysis = this.analyzeTrades(allTrades, tokenInfo);
            
            logger.info(`Bundle analysis completed for ${tokenAddress}:`, {
                bundleDetected: bundleAnalysis.bundleDetected,
                percentageBundled: bundleAnalysis.percentageBundled,
                totalBundles: bundleAnalysis.bundles.length
            });

            return {
                success: true,
                bundleDetected: bundleAnalysis.bundleDetected,
                percentageBundled: bundleAnalysis.percentageBundled,
                totalTokensBundled: bundleAnalysis.totalTokensBundled,
                totalSolSpent: bundleAnalysis.totalSolSpent,
                bundles: bundleAnalysis.bundles,
                totalTrades: allTrades.length,
                tokenInfo
            };

        } catch (error) {
            logger.error(`Error in bundle analysis for ${tokenAddress}:`, error);
            return {
                success: false,
                error: error.message,
                bundleDetected: false
            };
        }
    }

    async isPumpfunToken(tokenAddress) {
        try {
            // Try to fetch trades from PumpFun API
            const trades = await pumpfunApi.getAllTrades(tokenAddress, 1, 0);
            return Array.isArray(trades) && trades.length >= 0;
        } catch (error) {
            logger.debug(`Token ${tokenAddress} not found in PumpFun API: ${error.message}`);
            return false;
        }
    }

    async getTokenInfo(tokenAddress) {
        try {
            const solanaApi = getSolanaApi();
            const assetInfo = await solanaApi.getAsset(tokenAddress, 'bundleAnalysis', 'getTokenInfo');
            
            if (!assetInfo) {
                throw new Error('Token info not found');
            }

            return {
                symbol: assetInfo.symbol || 'Unknown',
                name: assetInfo.name || 'Unknown Token',
                decimals: assetInfo.decimals || 6,
                totalSupply: assetInfo.supply?.total || 0,
                address: tokenAddress
            };
        } catch (error) {
            logger.error(`Error fetching token info for ${tokenAddress}:`, error);
            return {
                symbol: 'Unknown',
                name: 'Unknown Token',
                decimals: 6,
                totalSupply: 0,
                address: tokenAddress
            };
        }
    }

    async fetchAllTrades(tokenAddress, limit) {
        try {
            let offset = 0;
            const pageLimit = 200;
            let hasMoreTransactions = true;
            const allTrades = [];

            while (hasMoreTransactions && allTrades.length < limit) {
                logger.debug(`Fetching trades from PumpFun API. Offset: ${offset}, Limit: ${pageLimit}`);
                
                const trades = await pumpfunApi.getAllTrades(tokenAddress, pageLimit, offset);

                if (trades && trades.length > 0) {
                    allTrades.push(...trades);
                    logger.debug(`Total trades fetched so far: ${allTrades.length}`);
                    offset += pageLimit;

                    if (allTrades.length >= limit) {
                        logger.debug(`Reached specified limit of ${limit} trades. Stopping pagination.`);
                        hasMoreTransactions = false;
                    }
                } else {
                    hasMoreTransactions = false;
                    logger.debug('No more trades found from PumpFun API');
                }
            }

            logger.info(`Total trades fetched for ${tokenAddress}: ${allTrades.length}`);
            return allTrades;

        } catch (error) {
            logger.error(`Error fetching trades for ${tokenAddress}:`, error);
            return [];
        }
    }

    analyzeTrades(trades, tokenInfo) {
        const bundles = {};
        let totalTokensBundled = 0;
        let totalSolSpent = 0;

        // Group trades by slot (block) to identify bundles
        trades.forEach(trade => {
            if (trade.is_buy) {
                if (!bundles[trade.slot]) {
                    bundles[trade.slot] = {
                        slot: trade.slot,
                        uniqueWallets: new Set(),
                        tokensBought: 0,
                        solSpent: 0,
                        transactions: []
                    };
                }
                
                bundles[trade.slot].uniqueWallets.add(trade.user);
                const tokenAmount = trade.token_amount / this.TOKEN_FACTOR;
                bundles[trade.slot].tokensBought += tokenAmount;
                bundles[trade.slot].solSpent += trade.sol_amount / this.SOL_FACTOR;
                bundles[trade.slot].transactions.push(trade);
            }
        });

        // Filter for actual bundles (multiple wallets in same slot)
        const actualBundles = Object.values(bundles)
            .filter(bundle => bundle.uniqueWallets.size >= 2)
            .map(bundle => ({
                ...bundle,
                uniqueWalletsCount: bundle.uniqueWallets.size,
                uniqueWallets: Array.from(bundle.uniqueWallets)
            }))
            .sort((a, b) => b.tokensBought - a.tokensBought);

        // Calculate totals for bundled transactions
        actualBundles.forEach(bundle => {
            totalTokensBundled += bundle.tokensBought;
            totalSolSpent += bundle.solSpent;
        });

        const bundleDetected = actualBundles.length > 0;
        const totalSupply = parseFloat(tokenInfo.totalSupply) || 1;
        const percentageBundled = (totalTokensBundled / totalSupply) * 100;

        return {
            bundleDetected,
            percentageBundled: Math.min(percentageBundled, 100), // Cap at 100%
            totalTokensBundled,
            totalSolSpent,
            bundles: actualBundles,
            bundleStats: {
                totalBundles: actualBundles.length,
                largestBundle: actualBundles[0] || null,
                averageBundleSize: actualBundles.length > 0 ? 
                    totalTokensBundled / actualBundles.length : 0
            }
        };
    }
}

module.exports = new BundleAnalyzer();