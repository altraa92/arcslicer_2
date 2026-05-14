# ArcSlicer

ArcSlicer is a private dark-pool style trading venue on Solana devnet, built with
Arcium. Sellers add SOL liquidity with hidden price floors, buyers submit one
private buy order, and Arcium checks whether the order can cross the private
pool. Solana only receives the executable settlement result.

Demo: https://arcslicer.vercel.app

Program: `8N8DZqLjpjmVey83Cy2BNKysBcBYvm9XHxpa7dyRsK9G`

## What It Does

ArcSlicer lets users discover that private liquidity exists without exposing the
trade details needed to front-run it. A seller deposits SOL and encrypts the
seller-side order data before it reaches the program. A buyer submits a desired
SOL size and max USDC price, also encrypted before submission. Arcium evaluates
the encrypted pool state and buyer request, then returns only the final fill
amount and blended cost needed for settlement.

The product flow is intentionally simple:

1. Sellers add hidden SOL liquidity to the private pool.
2. Buyers submit one private buy intent instead of browsing individual vaults.
3. Arcium matches against encrypted seller balances and price floors.
4. The app settles only the filled amount and final USDC cost on Solana.
5. Sellers can withdraw earned USDC or cancel remaining liquidity.

## Why Arcium Matters

Traditional onchain order books expose intent before execution. That makes large
orders vulnerable to front-running, copy trading, and MEV. ArcSlicer uses Arcium
as the encrypted execution layer:

- Seller price floors stay encrypted.
- Buyer bid intent stays encrypted.
- Internal pool balances stay encrypted during matching.
- Matching happens inside Arcium computation definitions.
- Solana is used for custody, token transfers, and final settlement.

Some metadata is still public because this is a Solana application: users sign
transactions, token transfers settle onchain, and the pool account exists on
devnet. The sensitive trading data - prices, bid limits, and private balance
updates - is what ArcSlicer keeps out of public pre-trade view.

## Current Architecture

The project has three main layers:

- `encrypted-ixs/` - Arcis encrypted computation definitions.
- `programs/arcslicer_2/` - Anchor program that queues Arcium work and settles
  SPL token transfers.
- `app/src/` - React/Vite frontend for wallet flow, encrypted orders, faucet
  support, and private pool UX.

The private pool uses four encrypted seller slots in the current devnet build.
That keeps the demo focused and reliable while still proving the core dark-pool
mechanic: buyer intent is submitted once, routed internally, and returned as one
blended fill result.

## Arcium Computations

ArcSlicer currently defines these encrypted instructions:

- `init_pool_book` - initializes the encrypted private pool book.
- `add_pool_order` - adds a seller order into an encrypted pool slot.
- `match_pool_v2` - matches a buyer request across encrypted pool liquidity.
- `cancel_pool_order` - removes a seller's remaining encrypted liquidity.
- `init_vault_balance`, `match_slice_v2`, `reveal_fill` - legacy v1 vault
  computations kept in the program for compatibility.

After changing `encrypted-ixs/`, rebuild Arcis, upload the generated `.arcis`
files to the Supabase public circuits bucket, then initialize computation
definitions on devnet.

## Tech Stack

- Solana devnet
- Anchor `0.32.1`
- Arcium client `0.9.7`
- Arcis encrypted Rust circuits
- SPL Token and wrapped SOL
- React `18`
- Vite
- Solana wallet adapter
- Supabase storage for `.arcis` circuit artifacts
- Vercel for frontend deployment

## Running Locally

Install dependencies:

```bash
yarn
```

Create a `.env` file with:

```bash
VITE_RPC_URL=https://api.devnet.solana.com
VITE_USDC_MINT=<devnet-usdc-mint>
VITE_FAUCET_SECRET_KEY=<optional-devnet-faucet-keypair-json>
```

Start the frontend:

```bash
yarn dev
```

Build the frontend:

```bash
yarn build
```

If the in-app SOL faucet is rate limited, fund the wallet with devnet SOL from
another devnet faucet before testing.

## Devnet Deployment Flow

Build the Solana program and Arcium circuits:

```bash
anchor build
arcium build
```

Upload the generated `.arcis` files from `build/` to the configured Supabase
circuits bucket. The program expects the files under:

```text
https://sszoguizxkwwfjihhrpx.supabase.co/storage/v1/object/public/circuits
```

Deploy the upgraded program:

```bash
arcium deploy \
  --cluster-offset 456 \
  --recovery-set-size 4 \
  --keypair-path ~/.config/solana/id.json \
  --rpc-url "https://devnet.helius-rpc.com/?api-key=<key>" \
  --skip-init
```

Initialize computation definitions:

```bash
node --no-experimental-fetch scripts/init-comp-defs.mjs
```

Deploy the frontend:

```bash
vercel deploy --prod
```

## Judging Criteria

**Innovation**

ArcSlicer turns a simple SOL/USDC swap into a private execution venue where
buyers submit encrypted intent and receive only the settled result. The v2 pool
removes buyer-side vault browsing and moves routing into encrypted computation.

**Technical Implementation**

The app combines Anchor custody, SPL token settlement, Arcium encrypted shared
state, client-side encryption, computation definition initialization, and a
production frontend. The matching circuit updates encrypted pool balances and
reveals only the minimum data needed to settle tokens.

**User Experience**

The interface is built around three actions: add liquidity, submit a private
buy, and manage your pool slot. Error messages are translated into user-friendly
language where possible, and devnet funding tools are included for testing.

**Impact**

Private execution is useful for traders, funds, OTC desks, and protocols that
need onchain settlement without broadcasting intent before execution. ArcSlicer
demonstrates how encrypted computation can reduce front-running risk while
keeping Solana as the settlement layer.

**Clarity**

The app explains what is public, what is encrypted, and why Arcium is needed.
Public Solana data handles custody and settlement; Arcium protects pre-trade
prices, bids, and private pool balance updates.
