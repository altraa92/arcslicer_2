// app/src/App.tsx
import { useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import DarkPool from "./components/DarkPool";

// @ts-ignore — CSS side-effect import; resolved by Vite at build time
import "@solana/wallet-adapter-react-ui/styles.css";

export default function App() {
  const endpoint = import.meta.env.VITE_RPC_URL;
  const wallets  = useMemo(() => [new PhantomWalletAdapter()], []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <DarkPool />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}