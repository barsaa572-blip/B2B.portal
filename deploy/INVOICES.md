# Wallet top-up invoices

## Deployment

This release adds Node dependencies for real PDF downloads. After updating the
checkout, run `npm ci --omit=dev --ignore-scripts` in `/opt/flightb2b` before
restarting the service. Deploy `assets/invoice/` including the Noto font files
and license. No database migration or change to the global Node version is needed.
Run `node --test tests/*.test.*` using the project's test runtime before release.

The wallet-credit preview truncates to one decimal (1858.391 becomes 1858.3).
Actual CNY credit continues to use the backend's existing two-decimal calculation.
Saved invoice totals and fees are not recalculated by the document renderer.

## Authorized company artwork

The supplied Air Sales scan has been extracted into Git-ignored
`private/invoice/stamp.png` and `private/invoice/signature.png`. The local renderer
uses these when present. Director name defaults to Д.Барсболд. Git push does NOT
upload these files: securely copy the two PNGs separately to the VPS private paths
below, readable by the `flightb2b` service account, and configure the environment.
Without artwork files, invoices retain a blank signature line.
Optional service environment variables:

```
INVOICE_STAMP_PATH=/etc/flightb2b/assets/airsales-stamp.png
INVOICE_SIGNATURE_PATH=/etc/flightb2b/assets/director-signature.png
INVOICE_DIRECTOR_NAME=Д.Барсболд
```

Use authorized PNG/JPEG files, each no larger than 5 MB, readable by the service
account. Keep these files outside the public checkout, and restrict permissions.
Blank paths use the optional local `private/invoice/` files. Restart after configuration
changes. Assets are embedded only in authorized invoice responses, not served as
public static files. Recipients can extract embedded artwork from downloaded
invoices; obtain company approval before enabling it.

Bank: Голомт банк; IBAN: MN240015001605336658; account holder: ЭЙР СЭЛС.

## Local verification

`node scripts/preview-invoice.mjs` creates a clearly labeled sample at
`output/pdf/NEXAHUB-invoice-preview.pdf`; it does not create a payable invoice or
access the database. The browser test `tests/topup-invoice-browser.cjs` uses mocked
API data and blocks all real external requests. Pass a Playwright module path as
its first argument if Playwright is not installed locally.
