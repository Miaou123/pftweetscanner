// CODEX API Test Script - Debug API key and connection issues
require('dotenv').config();
const axios = require('axios');

class CodexAPITester {
    constructor() {
        this.codexApiUrl = 'https://graph.codex.io/graphql';
        this.codexApiKey = process.env.CODEX_API_KEY;
    }

    async testAPIConnection() {
        console.log('🔍 CODEX API Connection Test');
        console.log('='.repeat(50));
        
        // Step 1: Check environment variables
        console.log('\n📋 Step 1: Environment Check');
        console.log(`CODEX_API_KEY exists: ${!!this.codexApiKey}`);
        if (this.codexApiKey) {
            console.log(`API Key length: ${this.codexApiKey.length} characters`);
            console.log(`API Key preview: ${this.codexApiKey.substring(0, 10)}...${this.codexApiKey.slice(-4)}`);
        } else {
            console.log('❌ CODEX_API_KEY not found in environment variables!');
            console.log('\n💡 Solutions:');
            console.log('1. Create a .env file in your project root');
            console.log('2. Add: CODEX_API_KEY=your_actual_api_key');
            console.log('3. Get your API key from: https://codex.io/dashboard');
            return;
        }

        // Step 2: Test simple query (getNetworks)
        console.log('\n📋 Step 2: Testing getNetworks Query');
        await this.testGetNetworks();

        // Step 3: Test token info query
        console.log('\n📋 Step 3: Testing Token Info Query');
        await this.testTokenInfo();

        // Step 4: Test getBars query with a known token
        console.log('\n📋 Step 4: Testing getBars Query');
        await this.testGetBars();
    }

    async testGetNetworks() {
        try {
            const query = `
                query GetNetworks {
                    getNetworks {
                        name
                        id
                    }
                }
            `;

            console.log('🔍 Testing getNetworks...');
            const response = await this.makeRequest(query);
            
            if (response.data && response.data.getNetworks) {
                console.log('✅ getNetworks successful!');
                console.log(`Found ${response.data.getNetworks.length} networks`);
                
                // Find Solana network
                const solanaNetwork = response.data.getNetworks.find(n => 
                    n.name.toLowerCase().includes('solana')
                );
                
                if (solanaNetwork) {
                    console.log(`🎯 Solana network found: ${solanaNetwork.name} (ID: ${solanaNetwork.id})`);
                } else {
                    console.log('⚠️ Solana network not found in list');
                    console.log('Available networks:', response.data.getNetworks.map(n => `${n.name} (${n.id})`).join(', '));
                }
            } else {
                console.log('❌ getNetworks failed - no data returned');
            }

        } catch (error) {
            console.log('❌ getNetworks failed:', error.message);
            this.analyzeError(error);
        }
    }

    async testTokenInfo() {
        try {
            // Test with a well-known Solana token (USDC)
            const query = `
                query GetTokenInfo($address: String!, $networkId: Int!) {
                    getTokenInfo(address: $address, networkId: $networkId) {
                        symbol
                        name
                        totalSupply
                    }
                }
            `;

            const variables = {
                address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC on Solana
                networkId: 101 // Solana mainnet
            };

            console.log('🔍 Testing getTokenInfo with USDC...');
            console.log(`Token: ${variables.address}`);
            console.log(`Network: ${variables.networkId}`);

            const response = await this.makeRequest(query, variables);
            
            if (response.data && response.data.getTokenInfo) {
                console.log('✅ getTokenInfo successful!');
                console.log(`Token: ${response.data.getTokenInfo.name} (${response.data.getTokenInfo.symbol})`);
                console.log(`Supply: ${response.data.getTokenInfo.totalSupply}`);
            } else {
                console.log('❌ getTokenInfo failed - no data returned');
            }

        } catch (error) {
            console.log('❌ getTokenInfo failed:', error.message);
            this.analyzeError(error);
        }
    }

    async testGetBars() {
        try {
            // Test with USDC for a short time range
            const now = Math.floor(Date.now() / 1000);
            const oneDayAgo = now - (24 * 60 * 60);

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
                symbol: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v:101", // USDC on Solana
                from: oneDayAgo,
                to: now,
                resolution: "1D"
            };

            console.log('🔍 Testing getBars with USDC...');
            console.log(`Symbol: ${variables.symbol}`);
            console.log(`Time range: ${new Date(oneDayAgo * 1000).toLocaleString()} to ${new Date(now * 1000).toLocaleString()}`);

            const response = await this.makeRequest(query, variables);
            
            if (response.data && response.data.getBars) {
                const bars = response.data.getBars;
                console.log('✅ getBars successful!');
                
                if (bars.t && bars.t.length > 0) {
                    console.log(`Found ${bars.t.length} data points`);
                    console.log(`Price range: $${Math.min(...bars.l)} - $${Math.max(...bars.h)}`);
                } else {
                    console.log('⚠️ No price data returned (empty bars)');
                }
            } else {
                console.log('❌ getBars failed - no data returned');
            }

        } catch (error) {
            console.log('❌ getBars failed:', error.message);
            this.analyzeError(error);
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

    analyzeError(error) {
        console.log('\n🔍 Error Analysis:');
        
        if (error.message.includes('401') || error.message.includes('Unauthorized')) {
            console.log('❌ Authentication Error');
            console.log('💡 Possible solutions:');
            console.log('   1. Check your API key is correct');
            console.log('   2. Ensure no extra spaces in your .env file');
            console.log('   3. Verify your API key is activated in CODEX dashboard');
            console.log('   4. Try regenerating your API key');
        } else if (error.message.includes('403') || error.message.includes('Forbidden')) {
            console.log('❌ Permission Error');
            console.log('💡 Your API key might not have access to this endpoint');
        } else if (error.message.includes('rate limit') || error.message.includes('429')) {
            console.log('❌ Rate Limit Error');
            console.log('💡 You\'re making requests too quickly');
        } else {
            console.log('❌ Other Error');
            console.log('💡 Check CODEX status or contact support');
        }
    }

    async testDifferentAuthFormats() {
        console.log('\n📋 Testing Different Authentication Formats');
        console.log('='.repeat(50));

        const authFormats = [
            { name: 'Direct API Key', header: this.codexApiKey },
            { name: 'Bearer Token', header: `Bearer ${this.codexApiKey}` },
            { name: 'API Key Prefix', header: `ApiKey ${this.codexApiKey}` },
            { name: 'X-API-Key Header', useXApiKey: true }
        ];

        for (const format of authFormats) {
            console.log(`\n🔍 Testing: ${format.name}`);
            
            try {
                const headers = {
                    'Content-Type': 'application/json'
                };

                if (format.useXApiKey) {
                    headers['X-API-Key'] = this.codexApiKey;
                } else {
                    headers['Authorization'] = format.header;
                }

                const response = await axios.post(this.codexApiUrl, {
                    query: '{ getNetworks { name id } }'
                }, {
                    headers,
                    timeout: 10000
                });

                if (response.data.errors) {
                    console.log(`❌ ${format.name}: ${JSON.stringify(response.data.errors)}`);
                } else {
                    console.log(`✅ ${format.name}: SUCCESS!`);
                    return format; // Return the working format
                }

            } catch (error) {
                console.log(`❌ ${format.name}: ${error.message}`);
            }
        }

        return null;
    }

    async checkAPIKeyStatus() {
        console.log('\n📋 API Key Status Check');
        console.log('='.repeat(30));

        if (!this.codexApiKey) {
            console.log('❌ No API key found');
            return;
        }

        // Check for common API key issues
        const issues = [];

        if (this.codexApiKey.includes(' ')) {
            issues.push('Contains spaces');
        }
        if (this.codexApiKey.length < 10) {
            issues.push('Too short (likely incomplete)');
        }
        if (this.codexApiKey.includes('\n')) {
            issues.push('Contains newline characters');
        }
        if (this.codexApiKey.startsWith('"') || this.codexApiKey.endsWith('"')) {
            issues.push('Wrapped in quotes');
        }

        if (issues.length > 0) {
            console.log('⚠️ Potential API key issues:');
            issues.forEach(issue => console.log(`   • ${issue}`));
        } else {
            console.log('✅ API key format looks correct');
        }
    }
}

// Main execution
async function main() {
    const tester = new CodexAPITester();
    
    await tester.testAPIConnection();
    await tester.checkAPIKeyStatus();
    
    console.log('\n📋 Additional Debugging');
    console.log('='.repeat(30));
    
    const workingFormat = await tester.testDifferentAuthFormats();
    
    if (workingFormat) {
        console.log(`\n🎉 Found working authentication format: ${workingFormat.name}`);
        console.log('💡 Update your main script to use this format');
    } else {
        console.log('\n❌ No authentication format worked');
        console.log('💡 Next steps:');
        console.log('   1. Double-check your API key from CODEX dashboard');
        console.log('   2. Ensure your account is activated');
        console.log('   3. Contact CODEX support if the issue persists');
    }
}

// Export for use as module
module.exports = CodexAPITester;

// Run if called directly
if (require.main === module) {
    main().catch(error => {
        console.error('❌ Test script failed:', error);
        process.exit(1);
    });
}