import { NextRequest, NextResponse } from 'next/server';
import { OAuth2Client } from 'google-auth-library';

const client = new OAuth2Client(process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID);

export async function POST(req: NextRequest) {
  try {
    const { id_token } = await req.json();

    if (!id_token) {
      return NextResponse.json({ error: 'Missing id_token' }, { status: 400 });
    }

    const ticket = await client.verifyIdToken({
      idToken: id_token,
      audience: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();

    if (!payload) {
      return NextResponse.json({ error: 'Invalid ID token payload' }, { status: 401 });
    }

    // You can also verify issuer, audience, and expiration here if needed
    // For example, if payload.aud is an array, check if your client ID is included
    // if (payload.aud !== process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID) {
    //   throw new Error('Audience mismatch');
    // }

    // Extract and return relevant, verified user information
    const verifiedUserInfo = {
      sub: payload.sub, // Google user ID
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
      // Potentially add other verified claims as needed
    };

    return NextResponse.json(verifiedUserInfo);
  } catch (error: any) {
    console.error('JWT verification failed:', error);
    return NextResponse.json({ error: error.message || 'Authentication failed' }, { status: 401 });
  }
}
