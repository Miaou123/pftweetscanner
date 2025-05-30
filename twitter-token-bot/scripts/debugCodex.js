// CODEX Debug Analyzer - Diagnose why tokens fail to get price data
require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');

class CodexDebugAnalyzer {
    constructor() {
        this.scanResultsDir = path.join(process.cwd(), 'scan_results');
        this.codexApiUrl = 'https://graph.codex.io/graphql';
        this.codexApiKey = process.env.CODEX_API_KEY;
        
        this.results = {
            totalTokens: 0,
            successful: 0,
            failed: 0,
            failureReasons: {},
            successfulTokens: [],
            failedTokens: []
        };
    }

    async debugTokenAnalysis() {
        console.log('🔍 CODEX Token Analysis Debug');
        console.log('='.repeat(50));
        
        // Test with your cleaned data first
        const cleanedData = [
            {
                "address": "HEgD31JKYNrGro696WfAdAkLdbiVMnNrVnDBWvXCpump",
                "symbol": "SBB",
                "timestamp": "2025-05-29T17:46:25.262Z"
            },
            {
                "address": "DDiP1d5aAjdKUCq1WrJGshk58TUFAkdmZ3zUXwAopump", 
                "symbol": "CHIPCOIN",
                "timestamp": "2025-05-29T18:57:02.636Z"
            },
            {
                "address": "ETPHY7f7iVJyXCuCngHNCyJJPkHkH4ZLmrKzUP49pump",
                "symbol": "CHONKY", 
                "timestamp": "2025-05-29T12:41:41.324Z"
            },
            {
                "address": "9uLrFti5DUHM4DSzGgANwnPXb2SwVQd5SGa66ceUpump",
                "symbol": "GOONB",
                "timestamp": "2025-05-24T20:16:21.366Z"
            },
            {
                "address": "HCXJPfa4Lp6JyjmrdRpSoozGh8as24JnKM1GNFp2pump",
                "symbol": "KFCAT",
                "timestamp": "2025-05-29T12:57:43.321Z"
            }
        ];

        console.log(`Testing ${cleanedData.length} tokens for debug analysis...\n`);

        for (const token of cleanedData) {
            await this.debugSingleToken(token);
            // Add delay between requests
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        this.generateDebugReport();
    }

    async debugSingleToken(tokenData) {
        console.log(`🔍 Debugging: ${tokenData.symbol} (${tokenData.address.substring(0, 8)}...)`);
        
        const scanTimestamp = Math.floor(new Date(tokenData.timestamp).getTime() / 1000);
        const currentTimestamp = Math.floor(Date.now() / 1000);
        
        console.log(`   Scan time: ${new Date(scanTimestamp * 1000).toLocaleString()}`);
        console.log(`   Time range: ${Math.round((currentTimestamp - scanTimestamp) / 3600)} hours of data`);

        // Test 1: Check if token exists in CODEX at all
        await this.testTokenExists(tokenData.address, tokenData.symbol);
        
        // Test 2: Try different resolutions
        await this.testDifferentResolutions(tokenData.address, tokenData.symbol, scanTimestamp, currentTimestamp);
        
        // Test 3: Try different time ranges
        await this.testDifferentTimeRanges(tokenData.address, tokenData.symbol, scanTimestamp, currentTimestamp);
        
        console.log(''); // Add spacing
    }

    async testTokenExists(address, symbol) {
        console.log(`   🔍 Test 1: Check if token exists in CODEX...`);
        
        try {
            // Try to get basic token info
            const tokenInfoQuery = `
                query GetTokenInfo($address: String!, $networkId: Int!) {
                    getTokenInfo(address: $address, networkId: $networkId) {
                        symbol
                        name
                        totalSupply
                    }
                }
            `;

            const response = await this.makeRequest(tokenInfoQuery, {
                address: address,
                networkId: 1399811149
            });

            if (response.data && response.data.getTokenInfo) {
                console.log(`   ✅ Token found: ${response.data.getTokenInfo.name} (${response.data.getTokenInfo.symbol})`);
                return true;
            } else {
                console.log(`   ❌ Token not found in CODEX database`);
                this.addFailureReason('token_not_indexed');
                return false;
            }

        } catch (error) {
            console.log(`   ❌ Error checking token existence: ${error.message}`);
            this.addFailureReason('api_error_token_check');
            return false;
        }
    }

    async testDifferentResolutions(address, symbol, from, to) {
        console.log(`   🔍 Test 2: Try different resolutions...`);
        
        const resolutions = ['1', '5', '15', '60', '1D'];
        
        for (const resolution of resolutions) {
            try {
                const result = await this.getBarsData(address, from, to, resolution);
                
                if (result.success && result.dataPoints > 0) {
                    console.log(`   ✅ ${resolution}: ${result.dataPoints} data points found`);
                    console.log(`      Price range: $${result.priceRange.low} - $${result.priceRange.high}`);
                    return true;
                } else {
                    console.log(`   ❌ ${resolution}: ${result.error || 'No data'}`);
                }

            } catch (error) {
                console.log(`   ❌ ${resolution}: ${error.message}`);
            }
        }
        
        this.addFailureReason('no_price_data_any_resolution');
        return false;
    }

    async testDifferentTimeRanges(address, symbol, originalFrom, originalTo) {
        console.log(`   🔍 Test 3: Try different time ranges...`);
        
        const now = Math.floor(Date.now() / 1000);
        const timeRanges = [
            { name: 'Last 1 hour', from: now - 3600, to: now },
            { name: 'Last 6 hours', from: now - 6 * 3600, to: now },
            { name: 'Last 24 hours', from: now - 24 * 3600, to: now },
            { name: 'Last 7 days', from: now - 7 * 24 * 3600, to: now },
            { name: 'Original range', from: originalFrom, to: originalTo }
        ];

        for (const range of timeRanges) {
            try {
                const result = await this.getBarsData(address, range.from, range.to, '1D');
                
                if (result.success && result.dataPoints > 0) {
                    console.log(`   ✅ ${range.name}: ${result.dataPoints} data points`);
                    return true;
                } else {
                    console.log(`   ❌ ${range.name}: ${result.error || 'No data'}`);
                }

            } catch (error) {
                console.log(`   ❌ ${range.name}: ${error.message}`);
            }
        }
        
        this.addFailureReason('no_price_data_any_timerange');
        return false;
    }

    async getBarsData(address, from, to, resolution) {
        const query = `
            query GetBars($symbol: String!, $from: Int!, $to: Int!, $resolution: String!) {
                getBars(
                    symbol: $symbol
                    from: $from
                    to: $to
                    resolution: $resolution
                    removeLeadingNullValues: true
                ) {
                    t
                    h
                    l
                    o
                    c
                    v
                }
            }
        `;

        const variables = {
            symbol: `${address}:1399811149`,
            from: from,
            to: to,
            resolution: resolution
        };

        try {
            const response = await this.makeRequest(query, variables);
            
            if (response.data && response.data.getBars) {
                const bars = response.data.getBars;
                
                if (bars.t && bars.t.length > 0) {
                    const highs = bars.h.filter(h => h !== null && h > 0);
                    const lows = bars.l.filter(l => l !== null && l > 0);
                    
                    return {
                        success: true,
                        dataPoints: bars.t.length,
                        priceRange: {
                            high: highs.length > 0 ? Math.max(...highs).toFixed(8) : 'N/A',
                            low: lows.length > 0 ? Math.min(...lows).toFixed(8) : 'N/A'
                        }
                    };
                } else {
                    return {
                        success: false,
                        error: 'Empty bars array'
                    };
                }
            } else {
                return {
                    success: false,
                    error: 'No getBars data in response'
                };
            }

        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    async makeRequest(query, variables = {}) {
        try {
            const response = await axios.post(this.codexApiUrl, {
                query,
                variables
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': this.codexApiKey,
                },
                timeout: 30000
            });

            if (response.data.errors) {
                throw new Error(`GraphQL errors: ${JSON.stringify(response.data.errors)}`);
            }

            return response.data;

        } catch (error) {
            if (error.response) {
                throw new Error(`HTTP ${error.response.status}: ${JSON.stringify(error.response.data)}`);
            } else {
                throw error;
            }
        }
    }

    addFailureReason(reason) {
        this.results.failureReasons[reason] = (this.results.failureReasons[reason] || 0) + 1;
    }

    generateDebugReport() {
        console.log('\n📊 DEBUG ANALYSIS REPORT');
        console.log('='.repeat(50));
        
        console.log('\n🔍 Failure Reasons:');
        if (Object.keys(this.results.failureReasons).length === 0) {
            console.log('   ✅ No failures detected in test tokens');
        } else {
            Object.entries(this.results.failureReasons).forEach(([reason, count]) => {
                console.log(`   ❌ ${reason}: ${count} tokens`);
            });
        }
        
        console.log('\n💡 Recommendations:');
        console.log('   1. If tokens are "not indexed" - they might be too new for CODEX');
        console.log('   2. If "no price data" - try longer time ranges or lower resolution');
        console.log('   3. If API errors - check rate limiting or network issues');
        console.log('   4. Consider using DexScreener as backup for missing tokens');
        
        console.log('\n🔧 Potential Solutions:');
        console.log('   • Add retry logic with exponential backoff');
        console.log('   • Use fallback APIs (DexScreener, Jupiter) for missing tokens');
        console.log('   • Implement token age filtering (skip very new tokens)');
        console.log('   • Add longer delays between API calls');
    }
}

// Usage
async function main() {
    console.log('🔍 Starting CODEX Debug Analysis');
    console.log('='.repeat(40));
    
    const analyzer = new CodexDebugAnalyzer();
    await analyzer.debugTokenAnalysis();
}

// Export for use as module
module.exports = CodexDebugAnalyzer;

// Run if called directly
if (require.main === module) {
    main().catch(error => {
        console.error('❌ Debug analysis failed:', error);
        process.exit(1);
    });
}