const fetch = require('node-fetch');

const DISTRIBUTION_WALLET = '2LK7yxZsy6YVCkFQ4PrL644ve1fgRj5FuDexj5JgS753';
const ZOOT_MINT = '3max6YL5yL6nrLHN3iHZWqfH1ufoSWFXs6RA4VjLhAtd';
const HELIUS_API_KEY = process.env.HELIUS_API_KEY || '3036b078-dc16-44c0-9bf6-ac9d342d354d';

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=120');

    try {
        const distributions = await fetchDistributions();
        return res.json({ success: true, distributions });
    } catch (e) {
        console.error('Distribution fetch error:', e.message);
        return res.json({ success: false, error: e.message, distributions: [] });
    }
};

async function fetchDistributions() {
    const url = `https://api.helius.xyz/v0/addresses/${DISTRIBUTION_WALLET}/transactions?api-key=${HELIUS_API_KEY}&limit=100`;

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Helius error: ${response.status}`);
    }

    const data = await response.json();
    const distributions = [];

    for (const tx of data) {
        if (!tx.tokenTransfers || tx.tokenTransfers.length === 0) continue;

        for (const transfer of tx.tokenTransfers) {
            if (
                transfer.fromUserAccount === DISTRIBUTION_WALLET &&
                transfer.mint === ZOOT_MINT &&
                transfer.tokenAmount > 0
            ) {
                distributions.push({
                    recipient: transfer.toUserAccount,
                    zootAmount: transfer.tokenAmount,
                    txHash: tx.signature,
                    timestamp: tx.timestamp ? tx.timestamp * 1000 : Date.now()
                });
            }
        }
    }

    return distributions;
}
