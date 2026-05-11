import { NextRequest, NextResponse } from 'next/server';

export const config = {
  maxDuration: 60,
};

export async function POST(request: NextRequest) {
  try {
    // Vercel Cron calls this endpoint automatically
    // No additional auth needed here—the cleanup endpoint will verify the secret
    
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret) {
      console.error('[/cron/cleanup] CRON_SECRET not configured');
      return NextResponse.json(
        { error: 'Service temporarily unavailable' },
        { status: 503 }
      );
    }

    const response = await fetch(`${appUrl}/api/admin/cleanup-expired`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-cron-secret': cronSecret,
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        `Cleanup endpoint failed: ${response.status} ${
          errorData.error || response.statusText
        }`
      );
    }

    const data = await response.json();
    console.info(JSON.stringify({ level: 'info', route: '/cron/cleanup', event: 'cron_completed', deleted: data.deletedCount, timestamp: data.timestamp }));

    return NextResponse.json({
      success: true,
      ...data,
    });
  } catch (error) {
    console.error('[/cron/cleanup] Cleanup cron failed:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
