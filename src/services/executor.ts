// ============================================================
// Executor — Eksekusi beli/jual token via Uniswap V2 Base
// ============================================================
//
// 🔐 DRY_RUN=true (default) → cuma log, gak kirim tx nyata.
//    Ganti DRY_RUN=false di .env untuk LIVE.
//
// ============================================================

import { ethers } from 'ethers';
import { CONFIG } from '../config/index';
import { validateAddress } from '../utils/helpers';
import { logger, createContextLogger } from '../utils/logger';

const execLog = createContextLogger('executor');

// ─── Constants ───────────────────────────────────────────────────────────────

const UNISWAP_V2_ROUTER = '0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24';
const WETH_ADDRESS = '0x4200000000000000000000000000000000000006';
const BASE_CHAIN_ID = 8453;
const DEADLINE_MINUTES = 20;
const MAX_SLIPPAGE_BPS = 500; // 5%

const ROUTER_ABI = [
  'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)',
  'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
  'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)',
];

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() view returns (uint8)',
];

// ─── Result type ─────────────────────────────────────────────────────────────

export interface TxResult {
  success: boolean;
  txHash: string | null;
  amountOut: string;
  fee: string;
  tokenAddress: string;
  mode: 'DRY_RUN' | 'LIVE';
}

// ─── Init wallet ─────────────────────────────────────────────────────────────

function createWallet(): ethers.Wallet {
  const pk = CONFIG.privateKey;
  if (!pk) {
    throw new Error('PRIVATE_KEY kosong — isi .env untuk mode LIVE');
  }
  const provider = new ethers.JsonRpcProvider(CONFIG.rpcUrl, undefined, {
    staticNetwork: true,
  });
  return new ethers.Wallet(pk, provider);
}

// ─── BELI ────────────────────────────────────────────────────────────────────

/**
 * 🔐 BELI TOKEN — swap ETH → Token via Uniswap V2 Base.
 *
 * DRY_RUN=true → cuma log simulasi, gak execute.
 * DRY_RUN=false → kirim tx nyata ke blockchain.
 */
export async function buyToken(
  tokenAddress: string,
  amountInETH: string,
  slippageBps: number = 100
): Promise<TxResult> {
  // ── Validasi ────────────────────────────────────────────────────────────
  if (!validateAddress(tokenAddress)) {
    throw new Error(`Invalid token address: "${tokenAddress}"`);
  }

  const amountNum = parseFloat(amountInETH);
  if (isNaN(amountNum) || amountNum <= 0) {
    throw new Error(`Invalid amount: "${amountInETH}"`);
  }

  const finalSlippage = Math.min(slippageBps, MAX_SLIPPAGE_BPS);
  const amountWei = ethers.parseEther(amountInETH);

  // ── DRY RUN ─────────────────────────────────────────────────────────────
  if (CONFIG.dryRun) {
    execLog.info(
      `[DRY RUN] Buy ${tokenAddress} | ${amountInETH} ETH | slippage ${finalSlippage / 100}%`
    );
    return {
      success: true,
      txHash: null,
      amountOut: '0',
      fee: '0',
      tokenAddress,
      mode: 'DRY_RUN',
    };
  }

  // ── LIVE ────────────────────────────────────────────────────────────────
  const wallet = createWallet();
  const router = new ethers.Contract(UNISWAP_V2_ROUTER, ROUTER_ABI, wallet);

  // Cek balance
  const balance = await wallet.provider!.getBalance(wallet.address);
  if (balance < amountWei) {
    throw new Error(
      `Saldo ETH tidak cukup: ${ethers.formatEther(balance)} ETH`
    );
  }

  // Dapatkan quote
  let amountsOut: bigint[];
  try {
    amountsOut = await router.getAmountsOut(amountWei, [
      WETH_ADDRESS,
      tokenAddress,
    ]);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Gagal dapatkan quote: ${msg}`);
  }

  const expected = amountsOut[1];
  const minOut = (expected * BigInt(10000 - finalSlippage)) / BigInt(10000);

  // Kirim tx
  const deadline = Math.floor(Date.now() / 1000) + DEADLINE_MINUTES * 60;

  const tx = await router.swapExactETHForTokens(
    minOut,
    [WETH_ADDRESS, tokenAddress],
    wallet.address,
    deadline,
    { value: amountWei, gasLimit: 350_000 }
  );

  execLog.info(`Tx terkirim: ${tx.hash}`);
  const receipt = await tx.wait(1);

  if (receipt?.status !== 1) {
    throw new Error(`Tx ${tx.hash} REVERTED — cek https://basescan.org/tx/${tx.hash}`);
  }

  // Hitung token yg diterima
  const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
  const decimals = await tokenContract.decimals();
  const balanceAfter = await tokenContract.balanceOf(wallet.address);

  return {
    success: true,
    txHash: tx.hash,
    amountOut: ethers.formatUnits(balanceAfter, decimals),
    fee: receipt.gasUsed.toString(),
    tokenAddress,
    mode: 'LIVE',
  };
}

// ─── JUAL ────────────────────────────────────────────────────────────────────

/**
 * 🔐 JUAL TOKEN — swap Token → ETH via Uniswap V2 Base.
 *
 * DRY_RUN=true → cuma log simulasi, gak execute.
 * DRY_RUN=false → kirim tx nyata ke blockchain.
 */
export async function sellToken(
  tokenAddress: string,
  amountInToken: string,
  slippageBps: number = 100
): Promise<TxResult> {
  // ── Validasi ────────────────────────────────────────────────────────────
  if (!validateAddress(tokenAddress)) {
    throw new Error(`Invalid token address: "${tokenAddress}"`);
  }

  const amountNum = parseFloat(amountInToken);
  if (isNaN(amountNum) || amountNum <= 0) {
    throw new Error(`Invalid amount: "${amountInToken}"`);
  }

  const finalSlippage = Math.min(slippageBps, MAX_SLIPPAGE_BPS);

  // ── DRY RUN ─────────────────────────────────────────────────────────────
  if (CONFIG.dryRun) {
    execLog.info(
      `[DRY RUN] Sell ${tokenAddress} | ${amountInToken} tokens | slippage ${finalSlippage / 100}%`
    );
    return {
      success: true,
      txHash: null,
      amountOut: '0',
      fee: '0',
      tokenAddress,
      mode: 'DRY_RUN',
    };
  }

  // ── LIVE ────────────────────────────────────────────────────────────────
  const wallet = createWallet();
  const router = new ethers.Contract(UNISWAP_V2_ROUTER, ROUTER_ABI, wallet);
  const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);

  // Dapatkan decimals
  const decimals = await tokenContract.decimals();
  const amountWei = ethers.parseUnits(amountInToken, decimals);

  // Cek balance
  const balance = await tokenContract.balanceOf(wallet.address);
  if (balance < amountWei) {
    const tersedia = ethers.formatUnits(balance, decimals);
    throw new Error(`Saldo token tidak cukup: ${tersedia}`);
  }

  // Approve kalo perlu
  const allowance = await tokenContract.allowance(wallet.address, UNISWAP_V2_ROUTER);
  if (allowance < amountWei) {
    execLog.info('Approving router...');
    const appTx = await tokenContract.approve(UNISWAP_V2_ROUTER, amountWei, {
      gasLimit: 100_000,
    });
    await appTx.wait(1);
    execLog.info(`Approved: ${appTx.hash}`);
  }

  // Dapatkan quote
  let amountsOut: bigint[];
  try {
    amountsOut = await router.getAmountsOut(amountWei, [
      tokenAddress,
      WETH_ADDRESS,
    ]);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Gagal dapatkan quote: ${msg}`);
  }

  const expected = amountsOut[1];
  const minOut = (expected * BigInt(10000 - finalSlippage)) / BigInt(10000);

  // Kirim tx
  const deadline = Math.floor(Date.now() / 1000) + DEADLINE_MINUTES * 60;

  const tx = await router.swapExactTokensForETH(
    amountWei,
    minOut,
    [tokenAddress, WETH_ADDRESS],
    wallet.address,
    deadline,
    { gasLimit: 350_000 }
  );

  execLog.info(`Tx terkirim: ${tx.hash}`);
  const receipt = await tx.wait(1);

  if (receipt?.status !== 1) {
    throw new Error(`Tx ${tx.hash} REVERTED — cek https://basescan.org/tx/${tx.hash}`);
  }

  return {
    success: true,
    txHash: tx.hash,
    amountOut: ethers.formatEther(expected),
    fee: receipt.gasUsed.toString(),
    tokenAddress,
    mode: 'LIVE',
  };
}

export default { buyToken, sellToken };
