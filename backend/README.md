# Backend foundation

`server.mjs` is the local Node server. It serves the frontend and will be the only component allowed to call Spring Airlines.

## Safe configuration

Copy `.env.example` values to the hosting provider's environment settings. Do not create a real `.env` file inside Git, and never put Spring credentials in `app.js` or GitHub Pages.

`GET /api/backend/status` reports only whether configuration exists; it never returns keys, passwords, or tokens.

## Spring integration status

The HTTP JSON routes are mapped in `spring-client.mjs`. They will be connected after Spring provides the exact OAuth request example and test request/response samples.

Order detail (`getOrderDetailInfoC2`) is XML/SOAP. Its final XML envelope, SOAPAction, namespace, and response mapper must be implemented from Spring's XML example. This prevents sending an incorrectly guessed booking request.

## Database

The first Supabase schema is in `supabase/schema.sql`. It provides agencies, branches, profiles, wallets, wallet ledger, and bookings with row-level isolation. Before production, authentication, wallet updates, and all ticketing actions must be moved from the current demo frontend to server-side endpoints.
