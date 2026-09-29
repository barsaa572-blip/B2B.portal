# Automatic passenger/segment status

Supplier-confirmed contract: `getOrderDetailInfoC2`, `tktFlag` belongs to each
passenger/segment. 40 = flown, 41 = checked in. There is no no-show code and
no fixed supplier update time. Never infer usage from the clock.

## Deployment

1. Back up the target database. Run **only** `supabase/spring-status-sync.sql`
   in that project's SQL editor (not the empty staging installer).
2. Deploy these code/assets together and restart the existing Node service.
3. The worker starts after 30 seconds when Supabase and SOAP credentials are
   configured. `SPRING_STATUS_SYNC_ENABLED=false` disables it without disabling
   bookings or changing financial data. No new credentials are printed/stored.
4. Each ticketed booking is due every 15 minutes; a single worker claims at most
   five per minute and sends sequential requests. Backlogs can delay a check.
   Completed, fully flown bookings are rechecked daily. Changed itineraries
   become due again. Confirm this rate with the supplier before large-scale use.

The database RPCs use row locks and expiring leases. Results from an older
itinerary or superseded lease are discarded. Only the service role may call
them. Financial status, balances and change history are never overwritten.

## Required supplier validation before calling this live-verified

The existing parser reads `ticketList/flightBasicInfo`, endpoints and `timeBJ`.
Passenger matching currently reads `cardNo` (or `documentNumber`) inside each
ticket. A complete sanitized SOAP example/schema is still needed to verify
these identity fields and date representation in production. The provided
screenshot only confirms `tktFlag`, not the full identity/flight schema.

Matching requires an exact route, flight number, travel date and unique
passenger document. There is **no positional/name-only fallback**. Ambiguous,
missing or unknown values produce `unmatched`; previous verified values stay
visible, and no passenger is guessed to have flown. Tests use synthetic data,
not a live PNR. Flights whose supplier city code differs from the airport code
also remain unmatched until a documented mapping is available.

UI reads cached status every minute while visible; no per-booking supplier
burst on page load and no manual status button. The top-level Ticketed state
means financially issued, not all passengers flown. Per-person/leg badges show
actual supplier flags. Failed checks retain the previous records and timestamp.
No automatic no-show, refund, change, check-in or ticket issue is performed.
