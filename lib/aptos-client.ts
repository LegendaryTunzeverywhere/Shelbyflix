import { Aptos, AptosConfig, Network } from '@aptos-labs/ts-sdk';

const aptosClient = new Aptos(new AptosConfig({
  network: Network.CUSTOM,
  fullnode: process.env.NEXT_PUBLIC_SHELBYNET_NODE_URL ?? 'https://api.testnet.aptoslabs.com/v1',
  indexer: process.env.NEXT_PUBLIC_SHELBYNET_INDEXER_URL ?? 'https://api.testnet.aptoslabs.com/v1/graphql',
}));

export function getAptosClient(): Aptos {
  return aptosClient;
}
