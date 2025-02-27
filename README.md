# Example Vault Strategy

This is an example of a trading strategy that trades the funds in a vault.

⚠️ This is an example strategy and is not meant to be used as is in production, you will lose money.

## Explanation

### How the account permissions work

Accounts on drift can have a __delegate__. The vault has a drift account, and is able to assign a delegate to it. The delegate is able to sign transactions on behalf of the vault. This is how the strategy will be trading the vault funds.


### Strategy

Assumptions on the vault setup:
* vault has some redeem period, so depositors will not withdraw funds immediately
* the deposit token is spot marketIndex 0 (USDC)
* only provides liquidity on SOL-PERP

This vault strategy is a simple market making strategy that quotes around the current oracle price with a 10 bps edge. It provides liquidity with 20% of the vault's available balance (less any pending withdraws).

### Usage

1) install dependencies
    ```
    git clone git@github.com:drift-labs/drift-vault-example.git
    cd drift-vault-example
    bun install
    ```

2) set environment variables in a new .env file
    ```
    cp .env.example .env
    ```

3) run the strategy
    ```
    bun index.ts
    ```

### Monitoring

Vault Managers are responsible for making sure the vault has sufficient collateral to fulfil depositor withdrawals.

An example script for monitoring a Vault is available in the [scripts](../scripts) folder.

To run the script, run the following command:
```
bun monitor
```

This project was created using `bun init` in bun v1.1.9. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.
