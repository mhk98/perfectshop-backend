# Automatic courier status sync

The API server starts a courier sync worker after database initialization. It first runs after 10 seconds, then waits 5 minutes after each completed sweep. No browser session or extra cron service is required; the Node server must remain running.

The worker checks existing `in_courier` and `on_hold` orders with Steadfast or Pathao. Pathao requires a saved consignment ID or tracking code; Steadfast can also look up the invoice. Credentials come from the existing Courier API settings. Confirmed delivery updates the stored order status; `delivered_approval_pending` remains `in_courier` until the provider confirms it.

Optional backend environment variables:

- `COURIER_STATUS_SYNC_ENABLED=false` disables the worker (default: enabled).
- `COURIER_STATUS_SYNC_INTERVAL_MS=300000` sets the delay between sweeps (minimum 60000 ms).

Requests run sequentially with a 500 ms pause. Orders are scanned in pages using IDs so status changes do not skip later pages. A MySQL named lock prevents overlapping sweeps across server processes sharing a database. One database connection is held during a sweep. Failed requests are retried in the next sweep; logs identify the provider and order ID without logging provider response data. Concurrent staff edits are preserved and retried on a later sweep if still eligible.

Shutdown stops further requests and waits for the current request before closing the database. The admin refreshes visible order lists and counts every minute and when the tab becomes visible.

Deploy the backend and admin changes, then restart the backend. Existing eligible orders are included automatically. For verification without live provider/database calls, run `node --test tests/courier-status-sync.test.js tests/order-checkout.test.js`.
