# Frontend Mainnet Launch Runbook

## Pre-launch Checklist
- [ ] `NEXT_PUBLIC_STELLAR_NETWORK=mainnet` set in production environment
- [ ] `NEXT_PUBLIC_CONTRACT_ID` points to verified mainnet contract
- [ ] No hardcoded testnet references remain in source code
- [ ] All wallet error messages tested with Freighter on mainnet
- [ ] LCP < 2.5s and CLS < 0.1 verified via Lighthouse

## Environment Variables (Production)
| Variable | Description |
|---|---|
| `NEXT_PUBLIC_STELLAR_NETWORK` | Set to `mainnet` for production |
| `NEXT_PUBLIC_CONTRACT_ID` | Verified mainnet Soroban contract ID |
| `NEXT_PUBLIC_STELLAR_RPC_URL` | Mainnet RPC endpoint |
| `NEXT_PUBLIC_HORIZON_URL` | Mainnet Horizon URL |

## Deployment Steps
1. Confirm all env vars are set in your hosting provider (Vercel/Netlify)
2. Run `npm run build:frontend` locally to verify no build errors
3. Merge PR to `main` — CI pipeline handles deployment
4. Verify live site on mainnet after deploy

## Rollback Plan
If a critical bug is found after mainnet deploy:
1. Revert the merge commit: `git revert <commit-hash>`
2. Push revert to `main` — triggers automatic redeploy
3. Confirm the previous version is live
4. Open a new issue documenting what went wrong

## Monitoring
- Check Vercel/hosting dashboard for build errors
- Monitor browser console for wallet connection errors
- Watch Stellar network for failed contract calls
