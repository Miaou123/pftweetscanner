// src/tools/freshWalletChecker.js
const logger = require('../utils/logger');
const { getSolanaApi } = require('../integrations/solanaApi');

const FRESH_WALLET_THRESHOLD = 50;

async function isFreshWallet(address, targetTxHash = null, mainContext = 'default', subContext = 'freshWalletCheck') {
    logger.debug(`Checking if wallet ${address} is fresh (threshold: ${FRESH_WALLET_THRESHOLD} transactions)`);

    try {
        const solanaApi = getSolanaApi();
        
        // Get signatures for the address
        const options = { 
            limit: FRESH_WALLET_THRESHOLD + 1 // +1 to check if it exceeds threshold
        };

        // If we have a target transaction, get signatures until that point
        if (targetTxHash) {
            options.until = targetTxHash;
        }

        const signatures = await solanaApi.getSignaturesForAddress(
            address,
            options,
            mainContext,
            subContext
        );

        if (!signatures) {
            logger.warn(`No signatures found for wallet ${address}`);
            return true; // Consider it fresh if no transactions found
        }

        // If we have a target transaction, make sure we found it
        if (targetTxHash) {
            const foundTarget = signatures.find(sig => sig.signature === targetTxHash);
            if (!foundTarget) {
                logger.warn(`Target transaction ${targetTxHash} not found for wallet ${address}`);
                return false;
            }
        }

        // Calculate transaction count
        const txCount = targetTxHash ? signatures.length - 1 : signatures.length; // -1 if we exclude target tx
        const isFresh = txCount <= FRESH_WALLET_THRESHOLD;
        
        logger.debug(`Wallet ${address} has ${txCount} transactions, isFresh: ${isFresh}`);
        return isFresh;

    } catch (error) {
        logger.error(`Error checking if ${address} is a fresh wallet:`, error);
        if (error.stack) {
            logger.debug(`Error stack: ${error.stack}`);
        }
        return false;
    }
}

/**
 * Check if multiple wallets are fresh
 * @param {string[]} addresses - Array of wallet addresses
 * @param {string} targetTxHash - Optional target transaction hash
 * @param {string} mainContext - Context for logging
 * @param {string} subContext - Sub-context for logging
 * @returns {Promise<Object>} Object with address as key and boolean as value
 */
async function checkMultipleFreshWallets(addresses, targetTxHash = null, mainContext = 'default', subContext = 'batchFreshCheck') {
    logger.debug(`Checking ${addresses.length} wallets for fresh status`);
    
    const results = {};
    
    // Process in batches to avoid overwhelming the API
    const batchSize = 5;
    for (let i = 0; i < addresses.length; i += batchSize) {
        const batch = addresses.slice(i, i + batchSize);
        
        const batchPromises = batch.map(async (address) => {
            try {
                const result = await isFreshWallet(address, targetTxHash, mainContext, subContext);
                return { address, isFresh: result };
            } catch (error) {
                logger.warn(`Failed to check fresh status for ${address}:`, error);
                return { address, isFresh: false };
            }
        });
        
        const batchResults = await Promise.allSettled(batchPromises);
        
        batchResults.forEach((result) => {
            if (result.status === 'fulfilled') {
                results[result.value.address] = result.value.isFresh;
            } else {
                logger.warn('Batch check failed:', result.reason);
            }
        });
        
        // Small delay between batches
        if (i + batchSize < addresses.length) {
            await new Promise(resolve => setTimeout(resolve, 200));
        }
    }
    
    return results;
}

/**
 * Get detailed fresh wallet statistics
 * @param {string} address - Wallet address
 * @returns {Promise<Object>} Detailed statistics about the wallet
 */
async function getFreshWalletStats(address) {
    try {
        const solanaApi = getSolanaApi();
        
        // Get more signatures for detailed analysis
        const signatures = await solanaApi.getSignaturesForAddress(
            address,
            { limit: 200 }
        );

        if (!signatures || signatures.length === 0) {
            return {
                transactionCount: 0,
                isFresh: true,
                oldestTransaction: null,
                newestTransaction: null,
                averageDaysBetweenTx: 0,
                accountAge: 0
            };
        }

        const txCount = signatures.length;
        const isFresh = txCount <= FRESH_WALLET_THRESHOLD;
        
        // Get timestamps
        const timestamps = signatures
            .map(sig => sig.blockTime)
            .filter(time => time !== null)
            .sort((a, b) => a - b);

        const oldestTransaction = timestamps.length > 0 ? new Date(timestamps[0] * 1000) : null;
        const newestTransaction = timestamps.length > 0 ? new Date(timestamps[timestamps.length - 1] * 1000) : null;
        
        // Calculate account age
        const accountAge = oldestTransaction ? 
            Math.floor((Date.now() - oldestTransaction.getTime()) / (1000 * 60 * 60 * 24)) : 0;
        
        // Calculate average days between transactions
        let averageDaysBetweenTx = 0;
        if (timestamps.length > 1) {
            const totalTimeSpan = timestamps[timestamps.length - 1] - timestamps[0];
            const totalDays = totalTimeSpan / (60 * 60 * 24);
            averageDaysBetweenTx = totalDays / (timestamps.length - 1);
        }

        return {
            transactionCount: txCount,
            isFresh,
            oldestTransaction,
            newestTransaction,
            averageDaysBetweenTx: Math.round(averageDaysBetweenTx * 100) / 100,
            accountAge
        };

    } catch (error) {
        logger.error(`Error getting fresh wallet stats for ${address}:`, error);
        return {
            transactionCount: 0,
            isFresh: false,
            error: error.message
        };
    }
}

module.exports = {
    isFreshWallet,
    checkMultipleFreshWallets,
    getFreshWalletStats,
    FRESH_WALLET_THRESHOLD
};