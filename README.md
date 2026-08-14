# Flight B2B Portal - local preview

The live search integration is server-side. The SerpApi key is never placed in `index.html` or `app.js`.

Airport autocomplete uses the [OurAirports public-domain dataset](https://ourairports.com/data/) on the server. It is downloaded once per server process; Spring's `ULN` alias is retained for Ulaanbaatar.

## Run locally (PowerShell)

1. Create a new SerpApi key in the SerpApi dashboard. Do not use a key that has been pasted into chat or committed to source control.
2. In this folder, set the key only for the current terminal session:

```powershell
$env:SERPAPI_KEY = 'your-new-key'
node server.mjs
```

3. Open `http://127.0.0.1:4173` and use **Flight search**.

The `/api/flights` route sends the request to SerpApi from the server and returns a minimal, safe result to the browser. It does not issue tickets or debit the wallet.
