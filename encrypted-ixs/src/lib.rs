use arcis::*;

#[encrypted]
mod circuits {
    use arcis::*;

    pub struct VaultState {
        pub remaining_balance: u64,
        pub price_per_token: u64,
    }

    pub struct BuyRequest {
        pub amount_requested: u64,
        pub max_price: u64,
    }

    pub struct MatchResult {
        pub filled_amount: u64,
        pub cost: u64,
        pub new_vault_balance: u64,
    }

    pub struct PoolBookPrivate {
        pub balance0: u64,
        pub price0: u64,
        pub balance1: u64,
        pub price1: u64,
        pub balance2: u64,
        pub price2: u64,
        pub balance3: u64,
        pub price3: u64,
    }

    pub struct PoolMatchResult {
        pub filled_amount: u64,
        pub cost: u64,
    }

    #[instruction]
    pub fn init_vault_balance(vault_ctxt: Enc<Shared, VaultState>) -> Enc<Mxe, VaultState> {
        let vault = vault_ctxt.to_arcis();
        Mxe::get().from_arcis(VaultState {
            remaining_balance: vault.remaining_balance,
            price_per_token: vault.price_per_token,
        })
    }

    #[instruction]
    pub fn match_slice_v2(
        vault_ctxt: Enc<Mxe, VaultState>,
        request_ctxt: Enc<Shared, BuyRequest>,
    ) -> (u64, u64, Enc<Shared, MatchResult>, Enc<Mxe, VaultState>) {
        let vault = vault_ctxt.to_arcis();
        let req = request_ctxt.to_arcis();

        let price_ok: bool = req.max_price >= vault.price_per_token;
        let available: u64 = if price_ok {
            vault.remaining_balance
        } else {
            0u64
        };
        let fill: u64 = if req.amount_requested < available {
            req.amount_requested
        } else {
            available
        };

        let cost: u64 =
            ((fill as u128 * vault.price_per_token as u128) / 1_000_000_000u128) as u64;
        let new_balance: u64 = vault.remaining_balance - fill;

        (
            fill.reveal(),
            cost.reveal(),
            request_ctxt.owner.from_arcis(MatchResult {
                filled_amount: fill,
                cost,
                new_vault_balance: new_balance,
            }),
            Mxe::get().from_arcis(VaultState {
                remaining_balance: new_balance,
                price_per_token: vault.price_per_token,
            }),
        )
    }

    #[instruction]
    pub fn reveal_fill(
        result_ctxt: Enc<Mxe, MatchResult>,
        owner_ctxt: Enc<Shared, u64>,
    ) -> Enc<Shared, MatchResult> {
        let result = result_ctxt.to_arcis();
        owner_ctxt.owner.from_arcis(result)
    }

    #[instruction]
    pub fn init_pool_book(book_ctxt: Enc<Shared, PoolBookPrivate>) -> Enc<Mxe, PoolBookPrivate> {
        let book = book_ctxt.to_arcis();
        Mxe::get().from_arcis(PoolBookPrivate {
            balance0: book.balance0,
            price0: book.price0,
            balance1: book.balance1,
            price1: book.price1,
            balance2: book.balance2,
            price2: book.price2,
            balance3: book.balance3,
            price3: book.price3,
        })
    }

    #[instruction]
    pub fn add_pool_order(
        book_ctxt: Enc<Mxe, PoolBookPrivate>,
        order_ctxt: Enc<Shared, VaultState>,
        slot: u8,
    ) -> Enc<Mxe, PoolBookPrivate> {
        let book = book_ctxt.to_arcis();
        let order = order_ctxt.to_arcis();

        let balance0 = if slot == 0u8 { order.remaining_balance } else { book.balance0 };
        let price0 = if slot == 0u8 { order.price_per_token } else { book.price0 };
        let balance1 = if slot == 1u8 { order.remaining_balance } else { book.balance1 };
        let price1 = if slot == 1u8 { order.price_per_token } else { book.price1 };
        let balance2 = if slot == 2u8 { order.remaining_balance } else { book.balance2 };
        let price2 = if slot == 2u8 { order.price_per_token } else { book.price2 };
        let balance3 = if slot == 3u8 { order.remaining_balance } else { book.balance3 };
        let price3 = if slot == 3u8 { order.price_per_token } else { book.price3 };

        Mxe::get().from_arcis(PoolBookPrivate {
            balance0,
            price0,
            balance1,
            price1,
            balance2,
            price2,
            balance3,
            price3,
        })
    }

    #[instruction]
    pub fn match_pool_v2(
        book_ctxt: Enc<Mxe, PoolBookPrivate>,
        request_ctxt: Enc<Shared, BuyRequest>,
    ) -> (
        u64,
        u64,
        u64,
        u64,
        u64,
        u64,
        u64,
        u64,
        u64,
        u64,
        Enc<Shared, PoolMatchResult>,
        Enc<Mxe, PoolBookPrivate>,
    ) {
        let book = book_ctxt.to_arcis();
        let req = request_ctxt.to_arcis();

        let eligible0: u64 = if req.max_price >= book.price0 { book.balance0 } else { 0u64 };
        let fill0: u64 = if req.amount_requested < eligible0 {
            req.amount_requested
        } else {
            eligible0
        };
        let remaining_after0: u64 = req.amount_requested - fill0;

        let eligible1: u64 = if req.max_price >= book.price1 { book.balance1 } else { 0u64 };
        let fill1: u64 = if remaining_after0 < eligible1 {
            remaining_after0
        } else {
            eligible1
        };
        let remaining_after1: u64 = remaining_after0 - fill1;

        let eligible2: u64 = if req.max_price >= book.price2 { book.balance2 } else { 0u64 };
        let fill2: u64 = if remaining_after1 < eligible2 {
            remaining_after1
        } else {
            eligible2
        };
        let remaining_after2: u64 = remaining_after1 - fill2;

        let eligible3: u64 = if req.max_price >= book.price3 { book.balance3 } else { 0u64 };
        let fill3: u64 = if remaining_after2 < eligible3 {
            remaining_after2
        } else {
            eligible3
        };

        let cost0: u64 =
            ((fill0 as u128 * book.price0 as u128) / 1_000_000_000u128) as u64;
        let cost1: u64 =
            ((fill1 as u128 * book.price1 as u128) / 1_000_000_000u128) as u64;
        let cost2: u64 =
            ((fill2 as u128 * book.price2 as u128) / 1_000_000_000u128) as u64;
        let cost3: u64 =
            ((fill3 as u128 * book.price3 as u128) / 1_000_000_000u128) as u64;

        let total_fill: u64 = fill0 + fill1 + fill2 + fill3;
        let total_cost: u64 = cost0 + cost1 + cost2 + cost3;

        (
            total_fill.reveal(),
            total_cost.reveal(),
            fill0.reveal(),
            cost0.reveal(),
            fill1.reveal(),
            cost1.reveal(),
            fill2.reveal(),
            cost2.reveal(),
            fill3.reveal(),
            cost3.reveal(),
            request_ctxt.owner.from_arcis(PoolMatchResult {
                filled_amount: total_fill,
                cost: total_cost,
            }),
            Mxe::get().from_arcis(PoolBookPrivate {
                balance0: book.balance0 - fill0,
                price0: book.price0,
                balance1: book.balance1 - fill1,
                price1: book.price1,
                balance2: book.balance2 - fill2,
                price2: book.price2,
                balance3: book.balance3 - fill3,
                price3: book.price3,
            }),
        )
    }

    #[instruction]
    pub fn cancel_pool_order(
        book_ctxt: Enc<Mxe, PoolBookPrivate>,
        slot: u8,
    ) -> (u64, Enc<Mxe, PoolBookPrivate>) {
        let book = book_ctxt.to_arcis();
        let remaining = if slot == 0u8 {
            book.balance0
        } else if slot == 1u8 {
            book.balance1
        } else if slot == 2u8 {
            book.balance2
        } else {
            book.balance3
        };

        (
            remaining.reveal(),
            Mxe::get().from_arcis(PoolBookPrivate {
                balance0: if slot == 0u8 { 0u64 } else { book.balance0 },
                price0: if slot == 0u8 { 0u64 } else { book.price0 },
                balance1: if slot == 1u8 { 0u64 } else { book.balance1 },
                price1: if slot == 1u8 { 0u64 } else { book.price1 },
                balance2: if slot == 2u8 { 0u64 } else { book.balance2 },
                price2: if slot == 2u8 { 0u64 } else { book.price2 },
                balance3: if slot == 3u8 { 0u64 } else { book.balance3 },
                price3: if slot == 3u8 { 0u64 } else { book.price3 },
            }),
        )
    }
}
