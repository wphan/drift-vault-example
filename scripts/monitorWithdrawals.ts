import {
	AddressLookupTableAccount,
	ComputeBudgetProgram,
	Connection,
	Keypair,
	PublicKey,
	TransactionInstruction,
} from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import {
	BASE_PRECISION,
	BN,
	DriftClient,
	FastSingleTxSender,
	MarketType,
	PRICE_PRECISION,
	PositionDirection,
	PostOnlyParams,
	TEN,
	User,
	ZERO,
	convertToNumber,
	decodeName,
	getLimitOrderParams,
	getOrderParams,
	getUserAccountPublicKey,
} from '@drift-labs/sdk';

import { VAULT_PROGRAM_ID, Vault, VaultClient, VaultDepositor } from '@drift-labs/vaults-sdk';
import { IDL } from '@drift-labs/vaults-sdk';

import dotenv from 'dotenv';
dotenv.config();

const vaultAddressString = process.env.VAULT_ADDRESS;
if (!vaultAddressString) {
	throw new Error('must set VAULT_ADDRESS not set');
}
const vaultAddress = new PublicKey(vaultAddressString);

const connection = new Connection(process.env.RPC_HTTP_URL!, {
	wsEndpoint: process.env.RPC_WS_URL,
});
const driftClient = new DriftClient({
	connection,
	wallet: new anchor.Wallet(Keypair.generate()),
	env: 'mainnet-beta',
	opts: {},
	authority: vaultAddress, // this is the vault's address with a drift account
});
const vaultProgramId = VAULT_PROGRAM_ID;
const vaultProgram = new anchor.Program(
	IDL,
	vaultProgramId,
	driftClient.provider
);
const driftVault = new VaultClient({
	driftClient: driftClient as any,
	program: vaultProgram as any,
});
let vaultUser: User | undefined;

function isVaultLiquidatable(
	vd: VaultDepositor,
	vault: Vault,
	vaultEquityDeposit: BN,
	withdrawLimitInDeposit: BN,
	depositPrec: BN,
	depositSymbol: string
): boolean {
	const now = Date.now() / 1000;
	const redeemPeriodFinished = new BN(now)
		.sub(vd.lastWithdrawRequest.ts)
		.gte(vault.redeemPeriod);

	const withdrawAmount = vd.lastWithdrawRequest.shares
		.mul(vaultEquityDeposit)
		.div(vault.totalShares);
	const vaultCantWithdraw = withdrawAmount.gte(withdrawLimitInDeposit);

	const vaultAlreadyInLiquidation =
		!vault.liquidationStartTs.eqn(0) &&
		!vault.liquidationDelegate.equals(PublicKey.default);

	let liquidatable = false;
	if (vaultAlreadyInLiquidation) {
		liquidatable = true;
	}

	if (
		redeemPeriodFinished &&
		vaultCantWithdraw &&
		!vaultAlreadyInLiquidation
	) {
		liquidatable = true;
	}

	if (liquidatable) {
		const withdrawAmountInDeposit = convertToNumber(withdrawAmount, depositPrec);
		const freeCollateral = convertToNumber(withdrawLimitInDeposit, depositPrec);
		console.warn(`Vault is liquidatable, user ${vd.authority.toBase58()} is attempting to withdraw ${withdrawAmount.toString()} ${depositSymbol}, free collateral available: ${freeCollateral.toString()}`);
	}

	return liquidatable;
}

// Checks outstanding withdrawal requests and compares it with the vault's current free collateral (initial)
async function runMonitor(firstRun: boolean = false) {
	const vault = await driftVault.getVault(vaultAddress);
	if (vault.totalWithdrawRequested.eq(ZERO)) {
		return;
	}

	if (!vaultUser) {
		vaultUser = new User({
			driftClient,
			userAccountPublicKey: await getUserAccountPublicKey(
				driftClient.program.programId,
				vaultAddress,
				0 // vaults only have subaccount 0 for now
			),
		});
		await vaultUser.subscribe();
	} else {
		await vaultUser.fetchAccounts();
	}

	const withdrawLimitInDeposit = BN.max(
		vaultUser.getWithdrawalLimit(vault.spotMarketIndex, true),
		vaultUser.getWithdrawalLimit(vault.spotMarketIndex, false)
	);

	const vaultDepositors = await driftVault.getAllVaultDepositors(vaultAddress);
	const vaultEquityDeposit =
		await driftVault.calculateVaultEquityInDepositAsset({
			vault,
		});

	const spotMarket = driftClient.getSpotMarketAccount(vault.spotMarketIndex)!;
	const depositSymbol = decodeName(spotMarket.name);
	const depositPrec = TEN.pow(new BN(spotMarket.decimals));

	const withdrawRequestedNum = convertToNumber(vault.totalWithdrawRequested, depositPrec);
	if (vault.totalWithdrawRequested.gt(withdrawLimitInDeposit)) {
		console.warn(`Total withdrawals requested: ${withdrawRequestedNum} greater than current withdraw limit: ${withdrawLimitInDeposit}, withdrawal attempts will fail`);
	}

	if (firstRun) {
		console.log(`Withdrawal monitor started:`);
		console.log(`  Current withdrawals requested: ${withdrawRequestedNum} ${depositSymbol}`);
		console.log(`  Free collateral:               ${convertToNumber(withdrawLimitInDeposit, depositPrec)} ${depositSymbol}`);
	}


	// check for any depositors that make the vault liquidatable
	// https://github.com/drift-labs/drift-vaults/wiki#liquidations
	for (const depositor of vaultDepositors) {
		const vd = depositor.account;
		const liquidatable = isVaultLiquidatable(
			vd,
			vault,
			vaultEquityDeposit,
			withdrawLimitInDeposit,
			depositPrec,
			depositSymbol
		);
	}
}

async function main() {
	console.log(`Starting Withdrawals Monitor`);
	console.log(` Vault: ${vaultAddress.toBase58()}`);

	await driftClient.subscribe();

	// run mm loop every 60s
	await runMonitor(true);
	setInterval(runMonitor, 60_000);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
