# Backend foundation

`server.mjs` is the local Node server. It serves the frontend and will be the only component allowed to call Spring Airlines.

## Safe configuration

Copy `.env.example` values to the hosting provider's environment settings. Do not create a real `.env` file inside Git, and never put Spring credentials in `app.js` or GitHub Pages.

`GET /api/backend/status` reports only whether configuration exists; it never returns keys, passwords, or tokens.

## Spring integration status

The HTTP JSON routes are mapped in `spring-client.mjs`. Token signing is `uppercase(md5(appKey + "SHA2" + appSecret + timestamp + appKey))`; credentials must stay only in the server environment.

Order detail (`getOrderDetailInfoC2`) is XML/SOAP. Before calculating or submitting a refund, the backend looks up the PNR and resolves the supplier's `orderHeadId` values. The calculation and refund submit endpoints then use those same IDs. An optional `SPRING_ORDER_DETAIL_WSDL_URL` can be set; otherwise the configured credit-payment WSDL endpoint is reused.

## Database

The first Supabase schema is in `supabase/schema.sql`. It provides agencies, branches, profiles, wallets, wallet ledger, and bookings with row-level isolation. Before production, authentication, wallet updates, and all ticketing actions must be moved from the current demo frontend to server-side endpoints.
