// src/integrations/solanaApi.js
const axios = require('axios');
const logger = require('../utils/logger');
const BigNumber = require('bignumber.js');

class SolanaApi {
    constructor() {
        if (!process.env.HELIUS_RPC_URL) {
            throw new Error('HELIUS_RPC_URL is not set. Please check your environment variables.');
        }
        this.heliusUrl = process.env.HELIUS_RPC_URL;
        this.requestTimeout = 30000; // 30 seconds
        this.maxRetries = 3;
        this.retryDelay = 1000;
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
                const response = await axios.post(this.heliusUrl, requestData, {
                    timeout: this.requestTimeout,
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });

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
                logger.warn(`Helius API call attempt ${attempt}/${this.maxRetries} failed for ${method}:`, error.message);
                
                if (attempt === this.maxRetries) {
                    logger.error(`All attempts failed for Helius method ${method}`);
                    throw error;
                }
                
                // Wait before retrying
                await new Promise(resolve => setTimeout(resolve, this.retryDelay * attempt));
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

            if (!result?.token_info) {
                logger.error(`Invalid result for token ${tokenAddress}`);
                return null;
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
                adjustedSupply = new BigNumber(0);
            }

            const tokenData = {
                address: tokenAddress,
                decimals: parseInt(result.token_info.decimals) || 0,
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
            return null;
        }
    }

    async getTokenSupply(tokenAddress) {
        try {
            const result = await this.callHelius('getTokenSupply', [tokenAddress]);
            
            if (!result || result.value === undefined) {
                logger.error(`Unexpected result for getTokenSupply of token ${tokenAddress}:`, result);
                return null;
            }
            
            return result;
        } catch (error) {
            logger.error(`Error getting token supply for ${tokenAddress}:`, error);
            return null;
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
}

// Factory function to create instance
const getSolanaApi = () => new SolanaApi();

module.exports = { getSolanaApi };