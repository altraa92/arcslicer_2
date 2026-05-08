/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RPC_URL: string;
  readonly VITE_FAUCET_SECRET_KEY: string;
  readonly VITE_PROGRAM_ID: string;
  readonly VITE_ARCIUM_CLUSTER_OFFSET: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}