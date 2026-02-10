# Deployment Guide

Complete step-by-step guide for deploying the Token-Gated Video Gallery to production.

## Prerequisites

- [x] Aptos CLI installed
- [x] Vercel account (for frontend)
- [x] Aptos testnet/mainnet account with sufficient APT
- [x] All environment variables configured

## Part 1: Smart Contract Deployment

### Step 1: Compile the Contract

```bash
cd move-contracts

# Compile with named addresses
aptos move compile --named-addresses video_gallery=<YOUR_APTOS_ADDRESS>
```

**Expected output**: Contract compiles successfully without errors.

### Step 2: Test the Contract

```bash
# Run all tests
aptos move test
```

**Expected output**: All tests pass.

### Step 3: Deploy to Testnet

```bash
# Deploy to testnet
aptos move publish \
  --profile testnet \
  --named-addresses video_gallery=<YOUR_APTOS_ADDRESS> \
  --assume-yes
```

**Save the transaction hash** - you'll need it to verify deployment.

### Step 4: Initialize the Registry

After deployment, call the initialize function:

```bash
aptos move run \
  --function-id <YOUR_ADDRESS>::video_gallery::initialize \
  --profile testnet \
  --assume-yes
```

### Step 5: Verify Deployment

Check the contract on Aptos Explorer:
```
https://explorer.aptoslabs.com/account/<YOUR_ADDRESS>?network=testnet
```

You should see:
- Published modules
- Transaction history
- Resource data

### Step 6: Update Environment Variables

Copy your deployed module address and update `.env.local`:

```env
NEXT_PUBLIC_MODULE_ADDRESS=<YOUR_APTOS_ADDRESS>
```

## Part 2: Frontend Deployment (Vercel)

### Step 1: Prepare Repository

```bash
# Ensure all files are committed
git add .
git commit -m "Prepare for deployment"
git push origin main
```

### Step 2: Connect to Vercel

1. Go to [vercel.com](https://vercel.com)
2. Click "Add New Project"
3. Import your GitHub repository
4. Select the `token-gated-videos` folder

### Step 3: Configure Environment Variables

In Vercel project settings, add these variables:

```
NEXT_PUBLIC_APTOS_NETWORK=testnet
NEXT_PUBLIC_APTOS_NODE_URL=https://fullnode.testnet.aptoslabs.com/v1
NEXT_PUBLIC_TOKEN_ADDRESS=0x1::aptos_coin::AptosCoin
NEXT_PUBLIC_MODULE_ADDRESS=<YOUR_DEPLOYED_MODULE_ADDRESS>
NEXT_PUBLIC_SHELBY_API_URL=https://api.shelby.xyz
SHELBY_API_KEY=<YOUR_SHELBY_API_KEY>
```

### Step 4: Deploy

Click "Deploy" and wait for build to complete (~2-3 minutes).

### Step 5: Verify Deployment

Visit your deployed URL (e.g., `your-app.vercel.app`) and test:

- [x] Homepage loads
- [x] Wallet connects successfully
- [x] Gallery page shows mock videos
- [x] Upload page checks token access
- [x] Video player page loads

## Part 3: Post-Deployment Setup

### Test Token Distribution

For testnet, users can get test APT from:
```
https://aptoslabs.com/testnet-faucet
```

Share this link with testers.

### Monitor Smart Contract

Set up monitoring for:
- Transaction volume
- Gas costs
- Error rates
- Storage usage

### Shelby Integration (When Available)

1. Obtain Shelby API credentials
2. Update `.env` with real API keys
3. Replace mock functions in `lib/shelby.ts`
4. Redeploy frontend to Vercel

## Part 4: Mainnet Deployment (Production)

⚠️ **Only proceed after thorough testing on testnet**

### Security Audit

Before mainnet:
1. Conduct smart contract audit
2. Perform penetration testing
3. Review all access controls
4. Test with real tokens

### Mainnet Deployment Steps

1. **Deploy Contract to Mainnet**
```bash
aptos move publish \
  --profile mainnet \
  --named-addresses video_gallery=<YOUR_MAINNET_ADDRESS> \
  --assume-yes
```

2. **Update Environment**
```env
NEXT_PUBLIC_APTOS_NETWORK=mainnet
NEXT_PUBLIC_APTOS_NODE_URL=https://fullnode.mainnet.aptoslabs.com/v1
NEXT_PUBLIC_MODULE_ADDRESS=<YOUR_MAINNET_MODULE_ADDRESS>
```

3. **Redeploy Frontend**
   - Update environment variables in Vercel
   - Trigger new deployment

4. **Initialize Registry**
```bash
aptos move run \
  --function-id <YOUR_MAINNET_ADDRESS>::video_gallery::initialize \
  --profile mainnet \
  --assume-yes
```

## Deployment Checklist

### Pre-Deployment
- [ ] All tests passing
- [ ] Environment variables configured
- [ ] Smart contract audited (for mainnet)
- [ ] Frontend tested locally
- [ ] Documentation complete

### During Deployment
- [ ] Smart contract deployed successfully
- [ ] Registry initialized
- [ ] Frontend deployed to Vercel
- [ ] Environment variables set correctly
- [ ] DNS configured (if custom domain)

### Post-Deployment
- [ ] Smoke tests completed
- [ ] Wallet connection works
- [ ] Video upload functional
- [ ] Video streaming works
- [ ] Access control verified
- [ ] Error logging configured
- [ ] Analytics set up (optional)

## Rollback Plan

If deployment fails:

### Frontend Rollback
1. In Vercel, go to "Deployments"
2. Find previous working deployment
3. Click "Promote to Production"

### Smart Contract Rollback
⚠️ **Smart contracts cannot be rolled back!**
- Deploy a new fixed version
- Update `MODULE_ADDRESS` in frontend
- Redeploy frontend

## Monitoring & Maintenance

### Key Metrics to Monitor
- Upload success rate
- Video streaming performance
- Wallet connection errors
- Smart contract gas costs
- User token balances

### Tools
- **Frontend**: Vercel Analytics
- **Blockchain**: Aptos Explorer
- **Errors**: Browser console, Sentry (optional)
- **Uptime**: UptimeRobot

### Regular Maintenance
- Weekly: Review error logs
- Monthly: Check smart contract gas usage
- Quarterly: Security review
- Annually: Major updates

## Common Issues

### Issue: Contract deployment fails
**Solution**: Check account has enough APT for gas fees

### Issue: Frontend can't read contract
**Solution**: Verify `MODULE_ADDRESS` is correct in `.env`

### Issue: Videos won't upload
**Solution**: Check Shelby API credentials and integration

### Issue: Wallet connection fails
**Solution**: Ensure network matches (testnet/mainnet)

## Support

For deployment issues:
1. Check deployment logs in Vercel
2. Review Aptos Explorer for failed transactions
3. Open GitHub issue with error details
4. Join Aptos Discord for community support

## Next Steps

After successful deployment:
1. Share with beta testers
2. Gather feedback
3. Iterate on features
4. Plan marketing launch
5. Consider security audit for mainnet

---

**Congratulations!** 🎉 Your Token-Gated Video Gallery is now live!
