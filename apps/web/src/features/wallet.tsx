import { useState } from 'react';
import {
  useWallet,
  AptosWalletAdapterProvider,
} from '@aptos-labs/wallet-adapter-react';
import { Network } from '@aptos-labs/ts-sdk';
import { ticketApi as api } from '../store';
import { Notice } from './feedback';
function WalletLink() {
  const wallet = useWallet();
  const [challenge] = api.useChallengeMutation();
  const [link, mutation] = api.useLinkWalletMutation();
  const [error, setError] = useState<unknown>();
  async function connectWallet() {
    try {
      setError(undefined);
      const address = wallet.account?.address.toString();
      if (!address) throw new Error('Connect a wallet first');
      const normalized = `0x${address.replace(/^0x/, '').padStart(64, '0')}`;
      const c = await challenge({ wallet: normalized }).unwrap();
      const response = await wallet.signMessage({
        message: c.message,
        nonce: c.nonce,
        address: true,
        application: true,
        chainId: true,
      });
      const key = wallet.account?.publicKey;
      if (Array.isArray(key))
        throw new Error('Multisignature accounts are unsupported');
      const sig = response.signature;
      if (Array.isArray(sig))
        throw new Error('Multisignature accounts are unsupported');
      await link({
        challengeId: c.id,
        publicKey: typeof key === 'string' ? key : key?.toString(),
        signature: typeof sig === 'string' ? sig : sig.toString(),
        fullMessage: response.fullMessage,
      }).unwrap();
    } catch (e) {
      setError(e);
    }
  }
  return (
    <section className="panel">
      <h2>Optional collectible wallet</h2>
      <p>
        Aptos testnet · Standard Ed25519 wallets only. Collectibles are separate
        from admission.
      </p>
      {wallet.connected ? (
        <>
          <p>
            Connected: <code>{wallet.account?.address.toString()}</code>
          </p>
          <button
            disabled={mutation.isLoading}
            onClick={() => void connectWallet()}
          >
            Verify and link wallet
          </button>
          <button onClick={() => void wallet.disconnect()}>
            Disconnect wallet
          </button>
        </>
      ) : (
        <div className="actions">
          {wallet.wallets.map((w) => (
            <button
              key={w.name}
              onClick={() => {
                void wallet.connect(w.name);
              }}
            >
              Connect {w.name}
            </button>
          ))}
          {!wallet.wallets.length && <p>No compatible wallet detected.</p>}
        </div>
      )}
      <Notice error={error || mutation.error} />
      {mutation.data && <Notice>Wallet verified and linked.</Notice>}
    </section>
  );
}

export default function WalletPanel() {
  return (
    <AptosWalletAdapterProvider
      autoConnect={false}
      disableTelemetry
      dappConfig={{ network: Network.TESTNET }}
    >
      <WalletLink />
    </AptosWalletAdapterProvider>
  );
}
