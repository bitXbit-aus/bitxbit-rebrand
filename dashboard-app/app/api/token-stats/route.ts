import { NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";

const TOKEN_MINT = process.env.BITXBIT_TOKEN_MINT || "DK6PWMyuZ4NMjsm9AWNCTMKrajQYrtfMjMJ3QauX2UH5";
const SOLSCAN_API_KEY = process.env.SOLSCAN_API_KEY;
const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY;
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_CREATED_AT = "2021-10-17"; // bitxbit token creation date
const CACHE_TTL_SECONDS = 3600; // update Birdeye stats once per hour

interface TokenStats {
  price: number | null;
  priceChange24h: number | null;
  holders: number | null;
  liquidity: number | null;
  marketCap: number | null;
  createdAt: string;
  mint: string;
  errors: string[];
}

async function fetchHolderCountViaRpc(): Promise<number | null> {
  try {
    const connection = new Connection(SOLANA_RPC_URL, "confirmed");
    const mint = new PublicKey(TOKEN_MINT);
    const accounts = await connection.getProgramAccounts(TOKEN_PROGRAM_ID, {
      filters: [
        { dataSize: 165 }, // SPL token account size
        { memcmp: { offset: 0, bytes: mint.toBase58() } },
      ],
    });

    const owners = new Set<string>();
    for (const { account } of accounts) {
      // Owner pubkey is at bytes 32-64 of the token account data
      const ownerBytes = account.data.slice(32, 64);
      const owner = new PublicKey(ownerBytes).toBase58();
      owners.add(owner);
    }
    return owners.size;
  } catch (err) {
    console.error("RPC holder count failed:", err);
    return null;
  }
}

export async function GET() {
  const stats: TokenStats = {
    price: null,
    priceChange24h: null,
    holders: null,
    liquidity: null,
    marketCap: null,
    createdAt: TOKEN_CREATED_AT,
    mint: TOKEN_MINT,
    errors: [],
  };

  // Solscan Pro API V2 - latest price
  if (SOLSCAN_API_KEY) {
    try {
      const priceRes = await fetch(
        `https://pro-api.solscan.io/v2.0/token/price/latest?address=${TOKEN_MINT}`,
        {
          headers: { token: SOLSCAN_API_KEY },
          next: { revalidate: 60 },
        }
      );
      if (priceRes.ok) {
        const priceData = await priceRes.json();
        const tokenPrice = priceData?.data?.find((item: any) => item.address === TOKEN_MINT);
        if (tokenPrice) {
          stats.price = tokenPrice.price ?? null;
          stats.priceChange24h = tokenPrice.price_change_24h ?? null;
          stats.marketCap = tokenPrice.market_cap ?? null;
        }
      } else {
        stats.errors.push(`Solscan price API error: ${priceRes.status}`);
      }
    } catch (err) {
      stats.errors.push(`Solscan price fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Solscan Pro API V2 - holders
    try {
      const holdersRes = await fetch(
        `https://pro-api.solscan.io/v2.0/token/holders?address=${TOKEN_MINT}&page=1&page_size=10`,
        {
          headers: { token: SOLSCAN_API_KEY },
          next: { revalidate: 300 },
        }
      );
      if (holdersRes.ok) {
        const holdersData = await holdersRes.json();
        stats.holders = holdersData?.data?.total ?? null;
      } else {
        stats.errors.push(`Solscan holders API error: ${holdersRes.status}`);
      }
    } catch (err) {
      stats.errors.push(`Solscan holders fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    stats.errors.push("SOLSCAN_API_KEY not configured");
  }

  // Birdeye API - price, liquidity, market cap, holders (single call, cached 1 hour)
  if (BIRDEYE_API_KEY) {
    try {
      const birdRes = await fetch(
        `https://public-api.birdeye.so/defi/token_overview?address=${TOKEN_MINT}`,
        {
          headers: {
            "X-API-KEY": BIRDEYE_API_KEY,
            "x-chain": "solana",
          },
          next: { revalidate: CACHE_TTL_SECONDS },
        }
      );
      if (birdRes.ok) {
        const birdData = await birdRes.json();
        const d = birdData?.data;
        if (d) {
          if (d.price !== undefined && d.price !== null) stats.price = Number(d.price);
          if (d.history24hPrice !== undefined && d.history24hPrice !== null && d.price !== undefined) {
            const change = ((Number(d.price) - Number(d.history24hPrice)) / Number(d.history24hPrice)) * 100;
            stats.priceChange24h = Number(change.toFixed(2));
          } else if (d.priceChange24hPercent !== undefined && d.priceChange24hPercent !== null) {
            stats.priceChange24h = Number(d.priceChange24hPercent);
          }
          if (d.liquidity !== undefined && d.liquidity !== null) stats.liquidity = Number(d.liquidity);
          if (d.marketCap !== undefined && d.marketCap !== null) stats.marketCap = Number(d.marketCap);
          if (d.holder !== undefined && d.holder !== null) stats.holders = Number(d.holder);
        }
      } else {
        stats.errors.push(`Birdeye API error: ${birdRes.status}`);
      }
    } catch (err) {
      stats.errors.push(`Birdeye fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    stats.errors.push("BIRDEYE_API_KEY not configured");
  }

  // Dexscreener Keyless API - fallback liquidity and price
  if (stats.liquidity === null || stats.price === null) {
    try {
      const dexRes = await fetch(
        `https://api.dexscreener.com/latest/dex/tokens/${TOKEN_MINT}`,
        { next: { revalidate: 60 } }
      );
      if (dexRes.ok) {
        const dexData = await dexRes.json();
        const pairs = dexData?.pairs ?? [];
        const totalLiquidity = pairs.reduce((sum: number, pair: any) => {
          return sum + (pair.liquidity?.usd ?? 0);
        }, 0);
        if (stats.liquidity === null) stats.liquidity = totalLiquidity > 0 ? totalLiquidity : null;

        if (stats.price === null && pairs.length > 0) {
          stats.price = parseFloat(pairs[0].priceUsd) || null;
          if (stats.marketCap === null) stats.marketCap = pairs[0].marketCap ?? pairs[0].fdv ?? null;
        }
      } else {
        stats.errors.push(`Dexscreener API error: ${dexRes.status}`);
      }
    } catch (err) {
      stats.errors.push(`Dexscreener fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Free fallback: count unique holders directly from Solana RPC
  if (stats.holders === null) {
    const rpcHolders = await fetchHolderCountViaRpc();
    if (rpcHolders !== null) {
      stats.holders = rpcHolders;
    } else {
      stats.errors.push("RPC holder count failed");
    }
  }

  return NextResponse.json(stats, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Cache-Control": `public, s-maxage=${CACHE_TTL_SECONDS}, stale-while-revalidate=${CACHE_TTL_SECONDS * 2}`,
    },
  });
}

export async function OPTIONS() {
  return NextResponse.json({}, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
