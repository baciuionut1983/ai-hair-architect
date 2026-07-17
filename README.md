# AI Hair Architect

This prototype explores a mobile-first experience for hairstylists and beauty professionals. It combines:

- photo upload and camera capture UI
- hair analysis and recommendation logic
- techniques for coloring, cutting and lightening
- marketplace and product-brand exploration
- client records, calendar and community chat concept

## Run locally

Open [index.html](index.html) in a browser, or serve the folder with a simple static server.

Example:

```bash
python -m http.server 8000
```

Then open http://127.0.0.1:8000/

## Next.js migration (stage 1)

A new Next.js + TypeScript app was scaffolded in the `web` folder so migration can happen gradually without breaking the current prototype.

Run it with:

```bash
cd web
npm install
npm run dev
```

Then open http://127.0.0.1:3001/

## Checkout / payments

The prototype now includes a backend endpoint for checkout initiation. In the current local setup, if Stripe credentials are not configured, the endpoint returns a test fallback URL so the UI can still be exercised.

For real payments, add the following environment variables:

```env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PRICE_PRO=price_...
STRIPE_PRICE_SALON=price_...
APP_BASE_URL=http://127.0.0.1:3000
```
