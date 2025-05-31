// src/integrations/solanaApi.js - Enhanced with better timeout and error handling
const axios = require('axios');
const logger = require('../utils/logger');
const BigNumber = require('bignumber.js');

class SolanaApi {
    constructor() {
        if (!process.env.HELIUS_RPC_URL) {
            throw new Error('HELIUS_RPC_URL is not set. Please check your environment variables.');
        }
        this.heliusUrl = process.env.HELIUS_RPC_URL;
        this.requestTimeout = 60000; // Increased to 60 seconds
        this.maxRetries = 5; // Increased retries
        this.retryDelay = 2000; // Increased base delay
        
        // Add connection pooling and keep-alive
        this.axiosInstance = axios.create({
            timeout: this.requestTimeout,
            headers: {
                'Content-Type': 'application/json',
                'Connection': 'keep-alive',
                'Keep-Alive': 'timeout=30, max=100'
            },
            // Add connection reuse
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

    async callHelius(method, params, apiType = 'rpc') {
        const requestData = {
            jsonrpc: '2.0',
            id: 'helius-call',
            method: method,
            params: params
        };

        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                const response = await this.axiosInstance.post(this.heliusUrl, requestData);

                if (response.data.error) {
                    logger.error(`Helius RPC Error for ${method}:`, response.data.error);
                    throw new Error(`RPC Error: ${response.data.error.message}`);
                }

                if (response.data.result === undefined) {
                    logger.warn(`No result in response for ${method}`);
                    return null;
                }

                return response.data.result;

            } catch (error) {
                const isNetworkError = error.code === 'ETIMEDOUT' || 
                                     error.code === 'ENETUNREACH' || 
                                     error.code === 'ECONNRESET' ||
                                     error.code === 'ECONNREFUSED';
                
                logger.warn(`Helius API call attempt ${attempt}/${this.maxRetries} failed for ${method}:`, {
                    error: error.message,
                    code: error.code,
                    isNetworkError
                });
                
                if (attempt === this.maxRetries) {
                    logger.error(`All attempts failed for Helius method ${method} after ${this.maxRetries} tries`);
                    
                    // For network errors, return null instead of throwing
                    if (isNetworkError) {
                        logger.warn(`Network error for ${method}, returning null to allow graceful degradation`);
                        return null;
                    }
                    
                    throw error;
                }
                
                // Exponential backoff with jitter for network errors
                const delay = isNetworkError ? 
                    this.retryDelay * Math.pow(2, attempt - 1) + Math.random() * 1000 :
                    this.retryDelay * attempt;
                
                logger.info(`Retrying ${method} in ${Math.round(delay)}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    async getAsset(tokenAddress) {
        try {
            const result = await this.callHelius('getAsset', {
                id: tokenAddress,
                displayOptions: {
                    showFungible: true
                }
            }, 'api');

            // Handle null result gracefully
            if (!result) {
                logger.warn(`No asset data returned for ${tokenAddress}, using fallback`);
                return this.createFallbackTokenData(tokenAddress);
            }

            if (!result?.token_info) {
                logger.warn(`Invalid result structure for token ${tokenAddress}, using fallback`);
                return this.createFallbackTokenData(tokenAddress);
            }

            // Process the token data
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
                adjustedSupply = new BigNumber(1000000000); // Default to 1B
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
            // Return fallback data instead of null
            return this.createFallbackTokenData(tokenAddress);
        }
    }

    // Create fallback token data when API fails
    createFallbackTokenData(tokenAddress) {
        return {
            address: tokenAddress,
            decimals: 6, // PumpFun standard
            symbol: 'Unknown',
            name: 'Unknown Token',
            supply: {
                total: '1000000000' // Default 1B supply
            },
            price: 0
        };
    }

    async getTokenLargestAccounts(tokenAddress) {
        try {
            const result = await this.callHelius('getTokenLargestAccounts', [tokenAddress]);
            
            if (!result) {
                logger.debug(`No largest accounts found for token ${tokenAddress}`);
                return null;
            }
            
            return result;
        } catch (error) {
            logger.error(`Error getting largest token accounts for ${tokenAddress}:`, error);
            return null;
        }
    }
    
    async getBalance(address) {
        try {
            const result = await this.callHelius('getBalance', [address]);
            
            if (!result || result.value === undefined) {
                logger.debug(`No balance found for address: ${address}`);
                return { value: 0 };
            }
            
            return result;
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
            
            if (!result) {
                logger.debug(`No token accounts found for ${tokenAddress}`);
                return { token_accounts: [], cursor: null };
            }
            
            return result;
        } catch (error) {
            logger.error(`Error getting token accounts for ${tokenAddress}:`, error);
            return { token_accounts: [], cursor: null };
        }
    }

    async getTokenSupply(tokenAddress) {
        try {
            const result = await this.callHelius('getTokenSupply', [tokenAddress]);
            
            if (!result || result.value === undefined) {
                logger.error(`Unexpected result for getTokenSupply of token ${tokenAddress}:`, result);
                // Return fallback supply info
                return {
                    value: {
                        amount: '1000000000000000', // 1B with 6 decimals
                        decimals: 6,
                        uiAmount: 1000000000,
                        uiAmountString: '1000000000'
                    }
                };
            }
            
            return result;
        } catch (error) {
            logger.error(`Error getting token supply for ${tokenAddress}:`, error);
            // Return fallback supply info
            return {
                value: {
                    amount: '1000000000000000', // 1B with 6 decimals  
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
            
            if (!response || response.value === undefined) {
                logger.debug(`No account info found for address: ${address}`);
                return null;
            }
            
            return response;
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
            
            if (!result || !result.value) {
                logger.debug(`No token accounts found for owner ${ownerAddress} and mint ${tokenMintAddress}`);
                return [];
            }
            
            return result.value;
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
            
            if (!Array.isArray(result)) {
                logger.warn(`Expected array for getSignaturesForAddress, got:`, typeof result);
                return [];
            }
            
            return result;
        } catch (error) {
            logger.error(`Error getting signatures for address ${address}:`, error);
            return [];
        }
    }

    async getTransaction(signature, options = { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }) {
        try {
            const result = await this.callHelius('getTransaction', [signature, options]);
            
            if (!result) {
                logger.debug(`No transaction details found for signature ${signature}`);
                return null;
            }
            
            return result;
        } catch (error) {
            logger.error(`Error getting transaction ${signature}:`, error);
            return null;
        }
    }

    // Health check method
    async healthCheck() {
        try {
            const result = await this.callHelius('getHealth');
            return result === 'ok';
        } catch (error) {
            logger.error('Helius health check failed:', error);
            return false;
        }
    }

    // Get version info
    async getVersion() {
        try {
            return await this.callHelius('getVersion');
        } catch (error) {
            logger.error('Failed to get version:', error);
            return null;
        }
    }

    // Add cleanup method
    destroy() {
        // Clean up any remaining connections
        if (this.axiosInstance) {
            this.axiosInstance = null;
        }
    }
}

// Factory function to create instance
const getSolanaApi = () => new SolanaApi();

module.exports = { getSolanaApi };