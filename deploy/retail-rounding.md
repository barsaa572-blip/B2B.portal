# MNT retail pricing rollout

Default: disabled (`MNT_ROUNDING_ENABLED=false`). This change has not been deployed to the VPS or applied to Supabase by the coding agent.

## Calculation

- Verified ticket fare and taxes/fees are each rounded UP to a multiple of 100 MNT per passenger, then multiplied by passenger count and summed. Do not round the sum again.
- Change fare difference, change fee and payment fee are each rounded up and summed. Negative supplier components fail closed for manual reconciliation.
- Final refund payout is rounded DOWN to a multiple of 100 MNT, using the refund/bank-buy rate.
- Convert the final MNT amount once to nearest 0.01 CNY for the wallet. Spring receives the original supplier CNY, never the rounded selling price.
- Exact multiples and zero stay unchanged. CNY cent settlement can differ from the MNT display by at most half a CNY cent at the frozen FX rate. This residual and margin are stored privately.
- Example, using illustrative FX 540.8: 2041 CNY -> 1,103,772.8 MNT -> 1,103,800 MNT -> 2041.05 CNY debit. Margin: 0.05 CNY; conversion residual: -0.16 MNT.
- Wallet funding, existing ledger entries and previously issued ticket totals are not rewritten. Account balance remains the actual CNY balance, not a rounded sale price.

## Before enabling

1. Back up the database using the existing operational backup procedure. Review and apply **only** `supabase/retail-rounding.sql` after existing migrations including `security-hardening.sql`. Never run `deploy/staging/empty-test-schema.sql` on production.
2. Deploy the matching backend, frontend and assets together with rounding disabled. Do not deploy only display changes or only SQL.
3. Run the automated checks below. Verify the staging user, database and Spring credentials are isolated before any real test booking/payment. No supplier payment was made during local verification.
4. Set `MNT_ROUNDING_ENABLED=true` and restart the intended service only when ready. Verify one authorized booking, its wallet transaction, supplier payment and private audit together. Do not create a paid ticket solely as an unapproved test.

The backend checks the migration before sending a new rounded reservation. Issue confirmations include the frozen MNT/CNY price. The database compares the confirmed snapshot under lock before permitting a supplier payment. An expired/changed quote must be reviewed again. Ambiguous supplier/database failures remain `needs_review`; do not retry them automatically.

## Refund settlement

A submitted refund stays pending and does not credit the wallet. Once finance has independently verified settlement from Spring, a platform administrator opens **Administration -> Retail settlement audit -> Confirm settlement**, enters the actual supplier CNY amount and settlement reference, and confirms the rounded wallet credit. A mismatch is blocked for reconciliation. Repeated confirmation does not credit twice. The portal does not infer settlement from a successful refund request.

The audit shows the latest 500 records. Prepared quotes are not earned income. Supplier cost/margin are available only through the platform-admin audit; the private table and raw booking reads are not granted to browser roles. Agency screens show the selling price, with no separate margin line.

## Checks

```powershell
node --test tests/*.test.*
npm install --prefix .tmp-retail-db --cache .tmp-retail-db/npm-cache --no-save --no-package-lock --ignore-scripts @electric-sql/pglite@0.3.14
node scripts/test-retail-db.mjs
```

The PostgreSQL/WASM test is an ephemeral in-memory database with fake users and no external financial connections. It applies all migrations, reapplies this migration, checks atomic rounded debits, frozen confirmation, duplicate issue/change/refund prevention, pending refunds, zero refunds, and permissions. It does not replace deployment verification on hosted Supabase/PostgREST.

Optional local browser test (all API traffic intercepted):

```powershell
$env:FARE_TEST_BROWSER_CHANNEL='msedge'
node tests/fare-display-browser.cjs PATH_TO_PLAYWRIGHT_PACKAGE
```

## Rollback precautions

Do not drop the new tables or restore old debit routines after rounded transactions exist. Turning the flag off stops new rounded quotes, but already stored rounded ticket prices still require the matching backend and SQL. Preserve financial history and reconcile any `needs_review` operation before further spending. Do not rerun older permission/function migrations over this migration.
