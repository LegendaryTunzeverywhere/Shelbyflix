import { NextRequest, NextResponse } from 'next/server';
import { AccountAddress } from '@aptos-labs/ts-sdk';
import { getAptosClient } from '@/lib/aptos-client';

const APTOS_COIN_TYPE = '0x1::aptos_coin::AptosCoin';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const rawAddress = req.nextUrl.searchParams.get('address')?.trim() ?? '';

  let address: string;
  try {
    address = AccountAddress.from(rawAddress).toString();
  } catch {
    return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 });
  }

  try {
    const coins = await getAptosClient().account.getAccountCoinsData({
      accountAddress: address,
    });
    const shelbyUsdToken = process.env.NEXT_PUBLIC_SHELBYUSD_TOKEN_ADDRESS?.trim();

    let apt = 0;
    let shelbyUsd = 0;
    for (const coin of coins) {
      const assetType = coin.metadata?.asset_type ?? '';
      const amount = Number(coin.amount ?? 0) / 100_000_000;
      if (assetType.includes(APTOS_COIN_TYPE)) apt = amount;
      if (shelbyUsdToken && assetType.includes(shelbyUsdToken)) shelbyUsd = amount;
    }

    return NextResponse.json({ apt, shelbyUsd });
  } catch (error) {
    console.error('GET /api/wallet/balances failed:', error);
    return NextResponse.json(
      { error: 'Unable to load wallet balances' },
      { status: 502 },
    );
  }
}
