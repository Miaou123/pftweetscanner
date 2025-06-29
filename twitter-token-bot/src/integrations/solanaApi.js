// src/integrations/solanaApi.js - Enhanced with single retry after 15 seconds
const axios = require('axios');
const logger = require('../utils/logger');
const BigNumber = require('bignumber.js');

class SolanaApi {
    constructor() {
        if (!process.env.HELIUS_RPC_URL) {
            throw new Error('HELIUS_RPC_URL is not set. Please check your environment variables.');
        }
        this.heliusUrl = process.env.HELIUS_RPC_URL;
        this.requestTimeout = 15000; // 15 seconds per attempt
        this.retryDelay = 15000; // 15 seconds between retry
        
        this.axiosInstance = axios.create({
            timeout: this.requestTimeout,
            headers: {
                'Content-Type': 'application/json',
                'Connection': 'keep-alive',
                'Keep-Alive': 'timeout=30, max=100'
            },
            httpAgent: new (require('http')).Agent({ 
                keepAlive: true,
                maxSockets: 10
            }),
            httpsAgent: new (require('https')).Agent({ 
                keepAlive: true,
                maxSockets: 10
            })
        });
    }

    // Enhanced with single retry after 15 seconds
    async callHelius(method, params, apiType = 'rpc', retryCount = 0) {
        const requestData = {
            jsonrpc: '2.0',
            id: 'helius-call',
            method: method,
            params: params
        };

        try {
            const response = await this.axiosInstance.post(this.heliusUrl, requestData);

            // Check for Helius API errors
            if (response.data.error) {
                logger.error(`Helius RPC Error for ${method}:`, response.data.error);
                
                // Retry once if it's the first attempt and we got an API error
                if (retryCount === 0) {
                    logger.info(`${method} failed with API error, retrying in ${this.retryDelay / 1000}s...`);
                    await this.sleep(this.retryDelay);
                    return this.callHelius(method, params, apiType, 1);
                }
                
                return null; // Return null after retry
            }

            // Check for missing result
            if (response.data.result === undefined) {
                logger.warn(`No result in response for ${method}`);
                
                // Retry once if it's the first attempt and we got no result
                if (retryCount === 0) {
                    logger.info(`${method} returned no result, retrying in ${this.retryDelay / 1000}s...`);
                    await this.sleep(this.retryDelay);
                    return this.callHelius(method, params, apiType, 1);
                }
                
                return null; // Return null after retry
            }

            // Success - log if this was a retry
            if (retryCount > 0) {
                logger.info(`✅ ${method} succeeded on retry #${retryCount}`);
            }

            return response.data.result;

        } catch (error) {
            // Handle network errors, timeouts, etc.
            const isTimeout = error.code === 'ECONNABORTED' || error.message.includes('timeout');
            const errorType = isTimeout ? 'timeout' : 'network error';
            
            logger.warn(`Helius API call failed for ${method} (${errorType}):`, error.message);
            
            // Retry once if it's the first attempt
            if (retryCount === 0) {
                logger.info(`${method} failed with ${errorType}, retrying in ${this.retryDelay / 1000}s...`);
                await this.sleep(this.retryDelay);
                return this.callHelius(method, params, apiType, 1);
            }
            
            // Failed after retry
            logger.error(`❌ ${method} failed after retry, giving up`);
            return null;
        }
    }

    // Helper method for delays
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Rest of your existing methods stay the same...
    async getAsset(tokenAddress) {
        try {
            const result = await this.callHelius('getAsset', {
                id: tokenAddress,
                displayOptions: {
                    showFungible: true
                }
            }, 'api');

            if (!result) {
                logger.warn(`No asset data returned for ${tokenAddress}, using fallback`);
                return this.createFallbackTokenData(tokenAddress);
            }

            if (!result?.token_info) {
                logger.warn(`Invalid result structure for token ${tokenAddress}, using fallback`);
                return this.createFallbackTokenData(tokenAddress);
            }

            let adjustedSupply;
            try {
                const rawSupply = new BigNumber(result.token_info.supply || 0);
                const decimals = parseInt(result.token_info.decimals) || 0;
                
                if (isNaN(decimals) || decimals < 0) {
                    throw new Error(`Invalid decimals value: ${decimals}`);
                }
                
                adjustedSupply = rawSupply.dividedBy(new BigNumber(10).pow(decimals));
                
                if (!adjustedSupply.isFinite()) {
                    throw new Error('Supply calculation resulted in non-finite value');
                }
            } catch (error) {
                logger.error(`Error calculating supply for ${tokenAddress}:`, error);
                adjustedSupply = new BigNumber(1000000000);
            }

            const tokenData = {
                address: tokenAddress,
                decimals: parseInt(result.token_info.decimals) || 6,
                symbol: result.token_info.symbol || result.content?.metadata?.symbol || 'Unknown',
                name: result.content?.metadata?.name || 'Unknown Token',
                supply: {
                    total: adjustedSupply.toString()
                },
                price: parseFloat(result.token_info.price_info?.price_per_token) || 0
            };

            return tokenData;

        } catch (error) {
            logger.error(`Error fetching asset info for ${tokenAddress}:`, error);
            return this.createFallbackTokenData(tokenAddress);
        }
    }

    createFallbackTokenData(tokenAddress) {
        return {
            address: tokenAddress,
            decimals: 6,
            symbol: 'Unknown',
            name: 'Unknown Token',
            supply: {
                total: '1000000000'
            },
            price: 0
        };
    }

    async getTokenLargestAccounts(tokenAddress) {
        try {
            const result = await this.callHelius('getTokenLargestAccounts', [tokenAddress]);
            return result; // null if failed (after retry)
        } catch (error) {
            logger.error(`Error getting largest token accounts for ${tokenAddress}:`, error);
            return null;
        }
    }
    
    async getBalance(address) {
        try {
            const result = await this.callHelius('getBalance', [address]);
            return result || { value: 0 };
        } catch (error) {
            logger.error(`Error getting balance for ${address}:`, error);
            return { value: 0 };
        }
    }
    
    async getTokenAccounts(tokenAddress, limit = 1000, cursor = null) {
        try {
            const params = {
                mint: tokenAddress,
                limit: limit
            };
            
            if (cursor) {
                params.cursor = cursor;
            }
            
            const result = await this.callHelius('getTokenAccounts', params);
            return result || { token_accounts: [], cursor: null };
        } catch (error) {
            logger.error(`Error getting token accounts for ${tokenAddress}:`, error);
            return { token_accounts: [], cursor: null };
        }
    }

    async getTokenSupply(tokenAddress) {
        try {
            const result = await this.callHelius('getTokenSupply', [tokenAddress]);
            
            if (!result || result.value === undefined) {
                return {
                    value: {
                        amount: '1000000000000000',
                        decimals: 6,
                        uiAmount: 1000000000,
                        uiAmountString: '1000000000'
                    }
                };
            }
            
            return result;
        } catch (error) {
            logger.error(`Error getting token supply for ${tokenAddress}:`, error);
            return {
                value: {
                    amount: '1000000000000000',
                    decimals: 6,
                    uiAmount: 1000000000,
                    uiAmountString: '1000000000'
                }
            };
        }
    }

    async getAccountInfo(address, config = { encoding: 'jsonParsed' }) {
        try {
            const response = await this.callHelius('getAccountInfo', [address, config]);
            return response; // null if failed (after retry)
        } catch (error) {
            logger.error(`Error getting account info for ${address}:`, error);
            return null;
        }
    }

    async getTokenAccountsByOwner(ownerAddress, tokenMintAddress, config = { encoding: 'jsonParsed' }) {
        try {
            const params = [
                ownerAddress,
                {
                    mint: tokenMintAddress
                },
                config
            ];

            const result = await this.callHelius('getTokenAccountsByOwner', params);
            return result?.value || [];
        } catch (error) {
            logger.error(`Error getting token accounts for owner ${ownerAddress}:`, error);
            return [];
        }
    }

    async getSignaturesForAddress(address, options = {}) {
        try {
            const defaultOptions = {
                limit: 1000,
                ...options
            };

            const result = await this.callHelius('getSignaturesForAddress', [address, defaultOptions]);
            return Array.isArray(result) ? result : [];
        } catch (error) {
            logger.error(`Error getting signatures for address ${address}:`, error);
            return [];
        }
    }

    async getTransaction(signature, options = { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }) {
        try {
            const result = await this.callHelius('getTransaction', [signature, options]);
            return result; // null if failed (after retry)
        } catch (error) {
            logger.error(`Error getting transaction ${signature}:`, error);
            return null;
        }
    }

    async healthCheck() {
        try {
            const result = await this.callHelius('getHealth');
            return result === 'ok';
        } catch (error) {
            logger.error('Helius health check failed:', error);
            return false;
        }
    }

    async getVersion() {
        try {
            return await this.callHelius('getVersion');
        } catch (error) {
            logger.error('Failed to get version:', error);
            return null;
        }
    }

    destroy() {
        if (this.axiosInstance) {
            this.axiosInstance = null;
        }
    }
}

const getSolanaApi = () => new SolanaApi();

module.exports = { getSolanaApi };