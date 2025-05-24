// src/analysis/topHoldersAnalyzer.js
const { getSolanaApi } = require('../integrations/solanaApi');
const { isFreshWallet } = require('../tools/freshWalletChecker');
const logger = require('../utils/logger');
const BigNumber = require('bignumber.js');

class TopHoldersAnalyzer {
    constructor() {
        this.solanaApi = getSolanaApi();
        this.HIGH_VALUE_THRESHOLD = 100000; // $100k USD threshold for whales
        this.FRESH_WALLET_TX_THRESHOLD = 50; // Less than 50 transactions = fresh wallet
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
            logger.debug('Token info:', tokenInfo);

            // Get top holders
            const topHolders = await this.getTopHolders(tokenAddress, count);
            if (!topHolders || topHolders.length === 0) {
                logger.warn(`No holders found for token ${tokenAddress}`);
                return {
                    success: false,
                    error: "No holders found",
                    tokenInfo
                };
            }

            logger.info(`Found ${topHolders.length} top holders for analysis`);

            // Analyze each holder
            const analysisResults = await this.analyzeHolders(topHolders, tokenAddress, tokenInfo);

            // Generate summary
            const summary = this.generateSummary(analysisResults, tokenInfo);

            logger.info(`Top holders analysis completed for ${tokenAddress}:`, {
                totalHolders: analysisResults.length,
                whales: summary.whaleCount,
                freshWallets: summary.freshWalletCount
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
                tokenInfo: null
            };
        }
    }

    async getTopHolders(tokenAddress, count) {
        try {
            // This is a simplified version - you might need to adapt based on your data source
            // For now, we'll use a placeholder that you can replace with your actual holder fetching logic
            logger.debug(`Fetching top ${count} holders for ${tokenAddress}`);
            
            // You'll need to implement this based on your data source (Helius, etc.)
            // This is just a placeholder structure
            const holders = await this.fetchHoldersFromHelius(tokenAddress, count);
            
            return holders;

        } catch (error) {
            logger.error(`Error fetching top holders for ${tokenAddress}:`, error);
            return [];
        }
    }

    async fetchHoldersFromHelius(tokenAddress, count) {
        try {
            // Using Helius API to get token accounts
            const response = await this.solanaApi.callHelius('getTokenAccounts', {
                mint: tokenAddress,
                limit: count,
                sortBy: 'amount',
                sortDirection: 'desc'
            });

            if (!response || !response.token_accounts) {
                logger.warn(`No token accounts found for ${tokenAddress}`);
                return [];
            }

            const holders = response.token_accounts.map(account => ({
                address: account.owner,
                balance: account.amount,
                tokenBalance: account.amount,
                decimals: account.decimals || 6
            }));

            logger.debug(`Found ${holders.length} holders from Helius`);
            return holders;

        } catch (error) {
            logger.error(`Error fetching holders from Helius:`, error);
            return [];
        }
    }

    async analyzeHolders(holders, tokenAddress, tokenInfo) {
        const results = [];

        for (let i = 0; i < holders.length; i++) {
            const holder = holders[i];
            try {
                logger.debug(`Analyzing holder ${i + 1}/${holders.length}: ${holder.address}`);

                const analysis = await this.analyzeIndividualHolder(holder, tokenAddress, tokenInfo);
                results.push(analysis);

                // Small delay to avoid rate limiting
                if (i < holders.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }

            } catch (error) {
                logger.warn(`Error analyzing holder ${holder.address}:`, error);
                results.push({
                    address: holder.address,
                    error: error.message,
                    isWhale: false,
                    isFresh: false,
                    balance: holder.balance || 0
                });
            }
        }

        return results;
    }

    async analyzeIndividualHolder(holder, tokenAddress, tokenInfo) {
        const address = holder.address;
        const balance = new BigNumber(holder.balance || 0);
        const adjustedBalance = balance.dividedBy(new BigNumber(10).pow(tokenInfo.decimals || 6));

        // Calculate holding percentage
        const totalSupply = new BigNumber(tokenInfo.total_supply || 1000000000);
        const holdingPercentage = adjustedBalance.dividedBy(totalSupply).multipliedBy(100);

        // Get wallet value and transaction history (for whale and fresh detection only)
        const [accountInfo, signatures] = await Promise.all([
            this.getWalletValue(address),
            this.getWalletSignatures(address)
        ]);

        // Determine wallet type (only whale and fresh - no inactive check)
        const isWhale = await this.isWhaleWallet(address, accountInfo);
        const isFresh = await this.isFreshWallet(address, signatures);

        return {
            address,
            balance: adjustedBalance.toString(),
            holdingPercentage: holdingPercentage.toFixed(4),
            walletValue: accountInfo?.totalValue || 0,
            transactionCount: signatures?.length || 0,
            isWhale,
            isFresh,
            category: this.categorizeWallet(isWhale, isFresh),
            analysis: {
                solBalance: accountInfo?.solBalance || 0,
                tokenCount: accountInfo?.tokenCount || 0,
                lastActivity: signatures?.[0]?.blockTime || null
            }
        };
    }

    async getWalletValue(address) {
        try {
            // Get SOL balance
            const accountInfo = await this.solanaApi.getAccountInfo(address);
            const solBalance = accountInfo?.value?.lamports ? 
                accountInfo.value.lamports / 1e9 : 0;

            // Get token accounts (simplified)
            const tokenAccounts = await this.solanaApi.callHelius('getTokenAccounts', {
                owner: address,
                limit: 100
            });

            const tokenCount = tokenAccounts?.token_accounts?.length || 0;
            
            // Estimate total value (SOL + tokens)
            // For a more accurate calculation, you'd need to get token prices
            const estimatedTotalValue = solBalance * 200; // Rough SOL price estimate

            return {
                totalValue: estimatedTotalValue,
                solBalance,
                tokenCount
            };

        } catch (error) {
            logger.debug(`Error getting wallet value for ${address}:`, error);
            return { totalValue: 0, solBalance: 0, tokenCount: 0 };
        }
    }

    async getWalletSignatures(address) {
        try {
            const signatures = await this.solanaApi.getSignaturesForAddress(
                address, 
                { limit: this.FRESH_WALLET_TX_THRESHOLD + 1 }
            );
            return signatures || [];
        } catch (error) {
            logger.debug(`Error getting signatures for ${address}:`, error);
            return [];
        }
    }

    async isWhaleWallet(address, accountInfo) {
        const walletValue = accountInfo?.totalValue || 0;
        return walletValue >= this.HIGH_VALUE_THRESHOLD;
    }

    async isFreshWallet(address, signatures) {
        const txCount = signatures?.length || 0;
        return txCount <= this.FRESH_WALLET_TX_THRESHOLD;
    }

    categorizeWallet(isWhale, isFresh) {
        if (isWhale) return 'Whale';
        if (isFresh) return 'Fresh';
        return 'Regular';
    }

    generateSummary(analysisResults, tokenInfo) {
        const totalHolders = analysisResults.length;
        const whaleCount = analysisResults.filter(h => h.isWhale).length;
        const freshWalletCount = analysisResults.filter(h => h.isFresh).length;
        const regularWalletCount = totalHolders - whaleCount - freshWalletCount;

        // Calculate concentration metrics
        const top5Holdings = analysisResults.slice(0, 5)
            .reduce((sum, holder) => sum + parseFloat(holder.holdingPercentage || 0), 0);
        
        const top10Holdings = analysisResults.slice(0, 10)
            .reduce((sum, holder) => sum + parseFloat(holder.holdingPercentage || 0), 0);

        // Risk assessment (faster without inactive checks)
        const riskScore = this.calculateRiskScore(whaleCount, freshWalletCount, top5Holdings);
        const riskLevel = this.determineRiskLevel(riskScore);

        return {
            totalHolders,
            whaleCount,
            freshWalletCount,
            regularWalletCount,
            whalePercentage: ((whaleCount / totalHolders) * 100).toFixed(1),
            freshWalletPercentage: ((freshWalletCount / totalHolders) * 100).toFixed(1),
            concentration: {
                top5Percentage: top5Holdings.toFixed(2),
                top10Percentage: top10Holdings.toFixed(2)
            },
            riskScore,
            riskLevel,
            flags: this.generateFlags(whaleCount, freshWalletCount, top5Holdings)
        };
    }

    calculateRiskScore(whaleCount, freshWalletCount, top5Holdings) {
        let score = 100; // Start with perfect score

        // Penalize for too many fresh wallets
        if (freshWalletCount > 10) score -= 30;
        else if (freshWalletCount > 5) score -= 15;

        // Penalize for too many whales
        if (whaleCount > 8) score -= 20;
        else if (whaleCount > 5) score -= 10;

        // Penalize for high concentration
        if (top5Holdings > 80) score -= 40;
        else if (top5Holdings > 60) score -= 25;
        else if (top5Holdings > 40) score -= 10;

        return Math.max(0, score);
    }

    determineRiskLevel(score) {
        if (score >= 80) return 'LOW';
        if (score >= 60) return 'MEDIUM';
        if (score >= 40) return 'HIGH';
        return 'VERY_HIGH';
    }

    generateFlags(whaleCount, freshWalletCount, top5Holdings) {
        const flags = [];

        if (freshWalletCount > 10) {
            flags.push(`🔴 High fresh wallet count: ${freshWalletCount}/20`);
        } else if (freshWalletCount > 5) {
            flags.push(`🟡 Moderate fresh wallet count: ${freshWalletCount}/20`);
        }

        if (whaleCount > 8) {
            flags.push(`🔴 High whale concentration: ${whaleCount}/20`);
        } else if (whaleCount > 5) {
            flags.push(`🟡 Moderate whale presence: ${whaleCount}/20`);
        }

        if (top5Holdings > 80) {
            flags.push(`🔴 Very high concentration: Top 5 hold ${top5Holdings.toFixed(1)}%`);
        } else if (top5Holdings > 60) {
            flags.push(`🟡 High concentration: Top 5 hold ${top5Holdings.toFixed(1)}%`);
        }

        if (flags.length === 0) {
            flags.push('✅ Healthy holder distribution');
        }

        return flags;
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
}

// Export the class, not an instance
module.exports = TopHoldersAnalyzer;