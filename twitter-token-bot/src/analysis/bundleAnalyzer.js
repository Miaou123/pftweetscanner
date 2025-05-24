// src/analysis/bundleAnalyzer.js - Updated to match working bot
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

    async getTokenMetadata(tokenAddress) {
        try {
            logger.debug('Fetching token metadata from Helius API...');
            const solanaApi = getSolanaApi();
            
            // Get token and SOL info in parallel
            const [tokenAsset, solAsset] = await Promise.all([
                solanaApi.getAsset(tokenAddress),
                solanaApi.getAsset("So11111111111111111111111111111111111111112")
            ]);
    
            if (!tokenAsset) {
                throw new Error('Token metadata not found');
            }
    
            const tokenPrice = tokenAsset.price || 0;
            const solPrice = solAsset?.price || 0;
    
            const result = {
                decimals: tokenAsset.decimals || 6,
                symbol: tokenAsset.symbol || 'Unknown',
                name: tokenAsset.name || tokenAsset.symbol || 'Unknown',
                priceUsd: tokenPrice,
                solPriceUsd: solPrice,
                address: tokenAddress,
                totalSupply: tokenAsset.supply?.total ? 
                    new BigNumber(tokenAsset.supply.total).toNumber() : 1000000000 // Default 1B for PumpFun
            };
    
            logger.debug('Processed token metadata:', result);
            return result;
    
        } catch (error) {
            logger.error(`Error fetching token metadata for ${tokenAddress}:`, error);
            // Fallback to PumpFun defaults
            return {
                decimals: 6,
                symbol: 'Unknown',
                name: 'Unknown Token',
                address: tokenAddress,
                totalSupply: 1000000000 // 1 billion tokens
            };
        }
    }

    async analyzeBundle(tokenAddress, limit = 50000) {
        try {
            logger.info(`Starting bundle analysis for token: ${tokenAddress}`);

            // Fetch all trades for the token from PumpFun
            const allTrades = await this.fetchAllTrades(tokenAddress, limit);
            
            if (!allTrades || allTrades.length === 0) {
                logger.info(`No trades found for token ${tokenAddress}`);
                const tokenInfo = await this.getTokenMetadata(tokenAddress);
                return {
                    success: true,
                    bundleDetected: false,
                    totalTrades: 0,
                    tokenInfo
                };
            }

            // Get token info with metadata
            const tokenInfo = await this.getTokenMetadata(tokenAddress);

            // Analyze trades for bundles
            const bundleAnalysis = await this.analyzeTrades(allTrades, tokenInfo);
            
            logger.info(`Bundle analysis completed for ${tokenAddress}:`, {
                bundleDetected: bundleAnalysis.bundleDetected,
                percentageBundled: bundleAnalysis.percentageBundled,
                totalBundles: bundleAnalysis.bundles.length,
                totalHoldingAmountPercentage: bundleAnalysis.totalHoldingAmountPercentage
            });

            return {
                success: true,
                bundleDetected: bundleAnalysis.bundleDetected,
                percentageBundled: bundleAnalysis.percentageBundled,
                totalTokensBundled: bundleAnalysis.totalTokensBundled,
                totalSolSpent: bundleAnalysis.totalSolSpent,
                totalHoldingAmount: bundleAnalysis.totalHoldingAmount,
                totalHoldingAmountPercentage: bundleAnalysis.totalHoldingAmountPercentage,
                bundles: bundleAnalysis.bundles,
                totalTrades: allTrades.length,
                tokenInfo
            };

        } catch (error) {
            logger.error(`Error in bundle analysis for ${tokenAddress}:`, error);
            const tokenInfo = await this.getTokenMetadata(tokenAddress);
            return {
                success: false,
                error: error.message,
                bundleDetected: false,
                tokenInfo
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

    async analyzeTrades(trades, tokenInfo) {
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
        const filteredBundles = Object.values(bundles)
            .filter(bundle => bundle.uniqueWallets.size >= 2)
            .map(bundle => ({
                ...bundle,
                uniqueWalletsCount: bundle.uniqueWallets.size,
                uniqueWallets: Array.from(bundle.uniqueWallets)
            }))
            .sort((a, b) => b.tokensBought - a.tokensBought);

        // Calculate totals for bundled transactions
        filteredBundles.forEach(bundle => {
            totalTokensBundled += bundle.tokensBought;
            totalSolSpent += bundle.solSpent;
        });

        const percentageBundled = (totalTokensBundled / tokenInfo.totalSupply) * 100;

        logger.debug(`=== BUNDLE ANALYSIS DEBUG ===`);
        logger.debug(`Total bundles found: ${filteredBundles.length}`);
        logger.debug(`Total tokens bundled: ${totalTokensBundled}`);
        logger.debug(`Total supply: ${tokenInfo.totalSupply}`);
        
        // Calculate current holdings for each bundle
        const allBundles = await Promise.all(filteredBundles.map(async (bundle, index) => {
            try {
                logger.debug(`\n--- Processing Bundle ${index + 1} (Slot ${bundle.slot}) ---`);
                logger.debug(`Wallets in bundle: ${bundle.uniqueWallets.join(', ')}`);
                logger.debug(`Tokens bought: ${bundle.tokensBought}`);
                
                const holdingAmounts = await Promise.all(
                    bundle.uniqueWallets.map(async (wallet) => {
                        try {
                            const tokenAccounts = await getSolanaApi().getTokenAccountsByOwner(wallet, tokenInfo.address);
                            
                            const walletHolding = tokenAccounts.reduce((sum, account) => {
                                const amount = account.account?.data?.parsed?.info?.tokenAmount?.amount;
                                if (amount) {
                                    return sum + BigInt(amount);
                                }
                                return sum;
                            }, BigInt(0));
                            
                            const walletHoldingNumber = Number(walletHolding) / Math.pow(10, tokenInfo.decimals);
                            logger.debug(`  Wallet ${wallet}: ${walletHoldingNumber} tokens`);
                            
                            return walletHolding;
                        } catch (error) {
                            logger.warn(`Error processing wallet ${wallet}: ${error.message}`);
                            return BigInt(0);
                        }
                    })
                );

                const totalHolding = holdingAmounts.reduce((sum, amount) => sum + amount, BigInt(0));
                const totalHoldingNumber = Number(totalHolding) / Math.pow(10, tokenInfo.decimals);
                const holdingPercentage = (totalHoldingNumber / tokenInfo.totalSupply) * 100;
                
                logger.debug(`Bundle ${index + 1} total holding: ${totalHoldingNumber} (${holdingPercentage.toFixed(4)}%)`);

                return {
                    ...bundle,
                    holdingAmount: totalHoldingNumber,
                    holdingPercentage: holdingPercentage
                };
            } catch (error) {
                logger.error(`Error processing bundle ${index}: ${error.message}`);
                return {
                    ...bundle,
                    holdingAmount: 0,
                    holdingPercentage: 0,
                    error: error.message
                };
            }
        }));

        const totalHoldingAmount = allBundles.reduce((sum, bundle) => sum + bundle.holdingAmount, 0);
        const totalHoldingAmountPercentage = (totalHoldingAmount / tokenInfo.totalSupply) * 100;
        
        logger.debug(`\n=== FINAL TOTALS ===`);
        logger.debug(`Total holding amount calculated: ${totalHoldingAmount}`);
        logger.debug(`Total holding percentage: ${totalHoldingAmountPercentage}%`);
        
        // Sort by holding amount first, then by tokens bought
        const sortedBundles = allBundles.sort((a, b) => {
            const holdingDiff = (b.holdingAmount || 0) - (a.holdingAmount || 0);
            if (holdingDiff !== 0) return holdingDiff;
            return b.tokensBought - a.tokensBought;
        });

        const bundleDetected = filteredBundles.length > 0;

        return {
            bundleDetected,
            percentageBundled: Math.min(percentageBundled, 100), // Cap at 100%
            totalTokensBundled,
            totalSolSpent,
            totalHoldingAmount,
            totalHoldingAmountPercentage,
            bundles: sortedBundles,
            bundleStats: {
                totalBundles: filteredBundles.length,
                largestBundle: sortedBundles[0] || null,
                averageBundleSize: filteredBundles.length > 0 ? 
                    totalTokensBundled / filteredBundles.length : 0
            }
        };
    }
}

module.exports = new BundleAnalyzer();