const BASE = 'https://api.testnet.aptoslabs.com/v1';
export function normalizeAddress(value: string): string {
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(value))
    throw new Error('Invalid Aptos address');
  return `0x${value.slice(2).toLowerCase().padStart(64, '0')}`;
}
export interface TransferEvidence {
  hash: string;
  amount: bigint;
  sender: string;
}
export async function verifyTransfer(
  hash: string,
  sender: string,
  treasury: string,
  amount: bigint,
  earliest: Date,
  latest: Date,
): Promise<TransferEvidence> {
  const ledger = await fetch(BASE, { signal: AbortSignal.timeout(15000) });
  const info = (await ledger.json()) as { chain_id: number };
  if (info.chain_id !== 2) throw new Error('Only Aptos testnet is supported');
  const response = await fetch(`${BASE}/transactions/by_hash/${hash}`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('Transaction unavailable');
  const tx = (await response.json()) as {
    type: string;
    hash: string;
    sender: string;
    success: boolean;
    timestamp: string;
    payload: {
      function: string;
      arguments: string[];
      type_arguments: string[];
    };
  };
  const time = Number(BigInt(tx.timestamp) / 1000n);
  if (
    tx.type !== 'user_transaction' ||
    !tx.success ||
    tx.hash.toLowerCase() !== hash.toLowerCase() ||
    normalizeAddress(tx.sender) !== normalizeAddress(sender) ||
    tx.payload.function !== '0x1::aptos_account::transfer' ||
    tx.payload.type_arguments.length !== 0 ||
    normalizeAddress(tx.payload.arguments[0]) !== normalizeAddress(treasury) ||
    BigInt(tx.payload.arguments[1]) !== amount ||
    time < earliest.getTime() ||
    time > latest.getTime()
  )
    throw new Error(
      'Transfer does not match linked sender, treasury, amount, testnet, or hold timing',
    );
  return { hash: tx.hash, amount, sender: normalizeAddress(sender) };
}
