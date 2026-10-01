import { config } from '../../../shared/config';
import {
  db,
  one,
  transaction as databaseTransaction,
} from '../../../shared/db';
import { requireValue, assertRule } from '../../../shared/errors';
import { type Operation } from '../../../shared/types';
import { normalize } from '../../../shared/wallet-address';
import { AmbiguousOperation } from '../razorpay/client';

export interface Entry {
  function: `${string}::${string}::${string}`;
  functionArguments: string[];
}

export async function treasurySubmit(operationId: string, entry: Entry) {
  const {
    Aptos,
    AptosConfig,
    Network,
    Account: AptosAccount,
    Ed25519PrivateKey,
    SimpleTransaction,
  } = await import('@aptos-labs/ts-sdk');
  const aptos = new Aptos(new AptosConfig({ network: Network.TESTNET }));
  const signer = AptosAccount.fromPrivateKey({
    privateKey: new Ed25519PrivateKey(requireValue(config.APTOS_PRIVATE_KEY)),
  });
  assertRule(
    normalize(signer.accountAddress.toString()) ===
      normalize(requireValue(config.APTOS_TREASURY)),
    'TREASURY_MISMATCH',
    'Configured treasury key does not match address',
  );
  let operation = requireValue(
    await one<Operation>(
      db,
      'SELECT * FROM tc_provideroperation WHERE id=$1::uuid',
      operationId,
    ),
  );
  if (operation.status === 'confirmed') return;
  await databaseTransaction(async (transaction) => {
    await transaction.$executeRawUnsafe(
      "SELECT pg_advisory_xact_lock(hashtextextended('aptos-treasury',0))",
    );
    const busy = await one(
      transaction,
      "SELECT id FROM tc_provideroperation WHERE provider='aptos' AND id<>$1::uuid AND status IN ('preparing','submitting','submitted','uncertain') LIMIT 1",
      operationId,
    );
    assertRule(
      !busy,
      'TREASURY_BUSY',
      'Another treasury transaction requires reconciliation',
    );
    operation = requireValue(
      await one<Operation>(
        transaction,
        'SELECT * FROM tc_provideroperation WHERE id=$1::uuid FOR UPDATE',
        operationId,
      ),
    );
    if (!operation.data.signedBytes)
      await transaction.$executeRawUnsafe(
        "UPDATE tc_provideroperation SET status='preparing' WHERE id=$1::uuid",
        operationId,
      );
  });
  if (!operation.data.signedBytes) {
    const transaction = await aptos.transaction.build.simple({
      sender: signer.accountAddress,
      data: entry,
      options: { expireTimestamp: Math.floor(Date.now() / 1000) + 300 },
    });
    const auth = aptos.transaction.sign({ signer, transaction: transaction });
    const { generateUserTransactionHash, generateSignedTransaction } =
      await import('@aptos-labs/ts-sdk');
    const txHash = generateUserTransactionHash({
      transaction: transaction,
      senderAuthenticator: auth,
    });
    const signedBytes = Buffer.from(
      generateSignedTransaction({
        transaction: transaction,
        senderAuthenticator: auth,
      }),
    ).toString('hex');
    const data = {
      ...operation.data,
      transaction: Buffer.from(transaction.bcsToBytes()).toString('hex'),
      authenticator: Buffer.from(auth.bcsToBytes()).toString('hex'),
      signedBytes,
      txHash,
      sequence: transaction.rawTransaction.sequence_number.toString(),
      expiration:
        transaction.rawTransaction.expiration_timestamp_secs.toString(),
    };
    // Competing recovery workers may build, but only the first persisted bytes
    // can be submitted. The loser reloads those exact bytes below.
    await db.$executeRawUnsafe(
      "UPDATE tc_provideroperation SET data=$2::jsonb,external_id=$3,status='submitting' WHERE id=$1::uuid AND NOT (data ? 'signedBytes')",
      operationId,
      JSON.stringify(data),
      txHash,
    );
    operation = requireValue(
      await one<Operation>(
        db,
        'SELECT * FROM tc_provideroperation WHERE id=$1::uuid',
        operationId,
      ),
    );
  }
  const { Deserializer, AccountAuthenticator } =
    await import('@aptos-labs/ts-sdk');
  const transaction = SimpleTransaction.deserialize(
    new Deserializer(Buffer.from(String(operation.data.transaction), 'hex')),
  );
  const auth = AccountAuthenticator.deserialize(
    new Deserializer(Buffer.from(String(operation.data.authenticator), 'hex')),
  );
  if (operation.external_id) {
    let result;
    try {
      result = await aptos.getTransactionByHash({
        transactionHash: operation.external_id,
      });
    } catch {
      /* A missing transaction can be submitted using identical bytes. */
    }
    if (result && 'success' in result) {
      if (!result.success)
        throw new AmbiguousOperation(
          'Treasury transaction failed; financial review required',
        );
      return;
    }
  }
  if (BigInt(String(operation.data.expiration)) * 1000n <= BigInt(Date.now()))
    throw new AmbiguousOperation(
      'Persisted treasury transaction expired; reconcile sequence and hash before rebuilding',
    );
  const result = await aptos.transaction.submit.simple({
    transaction: transaction,
    senderAuthenticator: auth,
  });
  await db.$executeRawUnsafe(
    "UPDATE tc_provideroperation SET external_id=$2,status='submitted' WHERE id=$1::uuid",
    operationId,
    result.hash,
  );
  const committed = await aptos.waitForTransaction({
    transactionHash: result.hash,
  });
  if (!committed.success)
    throw new AmbiguousOperation('Treasury transaction failed');
}
