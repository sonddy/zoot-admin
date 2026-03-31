const express = require('express');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname)));

// Configuration
const RECEIVING_WALLET = '5WihbrdC2LoJRKDvE8Fhpk7y5UtsV1eLSVhvQZ3tzoot';
const HELIUS_API_KEY = process.env.HELIUS_API_KEY || '3036b078-dc16-44c0-9bf6-ac9d342d354d';

// RPC Endpoints to try
const RPC_ENDPOINTS = [
    'https://api.mainnet-beta.solana.com',
    'https://rpc.ankr.com/solana',
    'https://solana-mainnet.core.chainstack.com/264c5e0086a2d9b37baf7e3ae1e42598'
];

// API endpoint to fetch transactions (server-side, no CORS issues!)
app.get('/api/transactions', async (req, res) => {
    console.log('Fetching transactions for wallet:', RECEIVING_WALLET);
    
    try {
        // Try Helius first
        const heliusData = await fetchFromHelius();
        if (heliusData && heliusData.length > 0) {
            console.log(`Helius returned ${heliusData.length} transactions`);
            return res.json({ success: true, source: 'helius', transactions: heliusData });
        }
    } catch (e) {
        console.log('Helius failed:', e.message);
    }
    
    try {
        // Fallback to Solscan
        const solscanData = await fetchFromSolscan();
        if (solscanData && solscanData.length > 0) {
            console.log(`Solscan returned ${solscanData.length} transactions`);
            return res.json({ success: true, source: 'solscan', transactions: solscanData });
        }
    } catch (e) {
        console.log('Solscan failed:', e.message);
    }
    
    try {
        // Fallback to RPC
        const rpcData = await fetchFromRPC();
        if (rpcData && rpcData.length > 0) {
            console.log(`RPC returned ${rpcData.length} transactions`);
            return res.json({ success: true, source: 'rpc', transactions: rpcData });
        }
    } catch (e) {
        console.log('RPC failed:', e.message);
    }
    
    res.json({ success: false, error: 'All data sources failed', transactions: [] });
});

// Fetch from Helius API
async function fetchFromHelius() {
    const url = `https://api.helius.xyz/v0/addresses/${RECEIVING_WALLET}/transactions?api-key=${HELIUS_API_KEY}&limit=100`;
    
    const response = await fetch(url);
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Helius error: ${response.status} - ${text}`);
    }
    
    const data = await response.json();
    const incomingTxs = [];
    
    for (const tx of data) {
        if (tx.nativeTransfers && tx.nativeTransfers.length > 0) {
            for (const transfer of tx.nativeTransfers) {
                if (transfer.toUserAccount === RECEIVING_WALLET && transfer.amount > 0) {
                    const amountInSol = transfer.amount / 1e9;
                    if (amountInSol >= 0.001) {
                        incomingTxs.push({
                            sender: transfer.fromUserAccount,
                            amount: amountInSol,
                            signature: tx.signature,
                            timestamp: tx.timestamp ? tx.timestamp * 1000 : Date.now(),
                            slot: tx.slot
                        });
                    }
                }
            }
        }
    }
    
    return incomingTxs;
}

// Fetch from Solscan API (no CORS on server!)
async function fetchFromSolscan() {
    const url = `https://api-v2.solscan.io/v2/account/transfer?address=${RECEIVING_WALLET}&page=1&page_size=100&sort_by=block_time&sort_order=desc`;
    
    const response = await fetch(url, {
        headers: {
            'Accept': 'application/json',
            'User-Agent': 'ZOOT-Admin/1.0'
        }
    });
    
    if (!response.ok) {
        throw new Error(`Solscan error: ${response.status}`);
    }
    
    const data = await response.json();
    const incomingTxs = [];
    
    if (data.success && data.data && Array.isArray(data.data)) {
        for (const tx of data.data) {
            if (tx.to_address === RECEIVING_WALLET && tx.amount > 0) {
                const amountInSol = tx.amount / 1e9;
                if (amountInSol >= 0.001) {
                    incomingTxs.push({
                        sender: tx.from_address,
                        amount: amountInSol,
                        signature: tx.trans_id,
                        timestamp: tx.block_time * 1000,
                        slot: tx.slot || 0
                    });
                }
            }
        }
    }
    
    return incomingTxs;
}

// Fetch from Solana RPC
async function fetchFromRPC() {
    let rpcUrl = RPC_ENDPOINTS[0];
    
    // Find working endpoint
    for (const endpoint of RPC_ENDPOINTS) {
        try {
            const testResponse = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' })
            });
            if (testResponse.ok) {
                rpcUrl = endpoint;
                break;
            }
        } catch (e) {
            continue;
        }
    }
    
    // Get signatures
    const sigResponse = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getSignaturesForAddress',
            params: [RECEIVING_WALLET, { limit: 50 }]
        })
    });
    
    const sigData = await sigResponse.json();
    if (sigData.error) throw new Error(sigData.error.message);
    
    const signatures = sigData.result || [];
    const incomingTxs = [];
    
    // Process each transaction
    for (let i = 0; i < Math.min(signatures.length, 30); i++) {
        const sig = signatures[i];
        
        try {
            const txResponse = await fetch(rpcUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'getTransaction',
                    params: [sig.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]
                })
            });
            
            const txData = await txResponse.json();
            
            if (txData.result && txData.result.meta && !txData.result.meta.err) {
                const tx = txData.result;
                const preBalances = tx.meta.preBalances;
                const postBalances = tx.meta.postBalances;
                const accountKeys = tx.transaction.message.accountKeys;
                
                let receiverIndex = -1;
                for (let j = 0; j < accountKeys.length; j++) {
                    const pubkey = typeof accountKeys[j] === 'string' ? accountKeys[j] : accountKeys[j].pubkey;
                    if (pubkey === RECEIVING_WALLET) {
                        receiverIndex = j;
                        break;
                    }
                }
                
                if (receiverIndex >= 0) {
                    const balanceChange = (postBalances[receiverIndex] - preBalances[receiverIndex]) / 1e9;
                    
                    if (balanceChange > 0.001) {
                        let senderAddress = 'Unknown';
                        for (let j = 0; j < accountKeys.length; j++) {
                            if (j !== receiverIndex && (postBalances[j] - preBalances[j]) < 0) {
                                senderAddress = typeof accountKeys[j] === 'string' ? accountKeys[j] : accountKeys[j].pubkey;
                                break;
                            }
                        }
                        
                        incomingTxs.push({
                            sender: senderAddress,
                            amount: balanceChange,
                            signature: sig.signature,
                            timestamp: (sig.blockTime || Math.floor(Date.now() / 1000)) * 1000,
                            slot: sig.slot
                        });
                    }
                }
            }
        } catch (txErr) {
            // Skip failed transactions
        }
    }
    
    return incomingTxs;
}

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', wallet: RECEIVING_WALLET });
});

// Start server
app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║           ZOOT Admin Server Running!                      ║
╠═══════════════════════════════════════════════════════════╣
║  Local:   http://localhost:${PORT}                          ║
║  Wallet:  ${RECEIVING_WALLET}   ║
╚═══════════════════════════════════════════════════════════╝
    `);
});
