const express = require('express');
const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs');

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3000);
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeSecretKey ? require('stripe')(stripeSecretKey) : null;
const subscriptionsFile = path.join(__dirname, 'subscriptions.json');

function readSubscriptions() {
  try {
    if (!fs.existsSync(subscriptionsFile)) return {};
    return JSON.parse(fs.readFileSync(subscriptionsFile, 'utf8'));
  } catch (error) {
    console.warn('Unable to read subscriptions store:', error);
    return {};
  }
}

function writeSubscriptions(data) {
  try {
    fs.writeFileSync(subscriptionsFile, JSON.stringify(data, null, 2));
  } catch (error) {
    console.warn('Unable to write subscriptions store:', error);
  }
}

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});
app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', stripeConfigured: Boolean(stripe) });
});

app.post('/api/checkout', async (req, res) => {
  try {
    const { plan = 'pro', customerEmail = '', directDebit = false } = req.body || {};
    const normalizedPlan = String(plan).toLowerCase();

    if (normalizedPlan === 'free') {
      return res.json({ success: true, mode: 'free', url: '/' });
    }

    if (!['pro', 'salon'].includes(normalizedPlan)) {
      return res.status(400).json({ error: 'Unsupported plan.', supportedPlans: ['pro', 'salon', 'free'] });
    }

    if (!stripe) {
      return res.json({
        success: true,
        mode: 'test-fallback',
        url: `https://checkout.stripe.com/pay/cs_test_example_${normalizedPlan}`,
        note: 'Stripe credentials are not configured yet. This fallback simulates the checkout redirect for local testing.'
      });
    }

    const priceId = normalizedPlan === 'pro'
      ? process.env.STRIPE_PRICE_PRO
      : process.env.STRIPE_PRICE_SALON;

    if (!priceId) {
      return res.status(400).json({
        error: 'Missing Stripe price ID.',
        guidance: `Set STRIPE_PRICE_${normalizedPlan.toUpperCase()} in the .env file.`
      });
    }

    const paymentMethodTypes = (process.env.STRIPE_PAYMENT_METHOD_TYPES || 'card')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

    const baseUrl = process.env.APP_BASE_URL || `http://127.0.0.1:${port}`;
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${baseUrl}/?checkout=success`,
      cancel_url: `${baseUrl}/?checkout=cancel`,
      customer_email: customerEmail || undefined,
      allow_promotion_codes: true,
      payment_method_types: paymentMethodTypes,
      metadata: {
        plan: normalizedPlan,
        directDebit: String(Boolean(directDebit)),
        source: 'ai-hair-architect'
      }
    });

    res.json({ success: true, url: session.url, sessionId: session.id, plan: normalizedPlan });
  } catch (error) {
    console.error('Checkout failed:', error);
    res.status(500).json({ error: error.message || 'Unable to create checkout session.' });
  }
});

app.post('/api/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  try {
    const payload = req.body ? req.body.toString('utf8') : '';
    if (!payload) {
      return res.status(400).json({ error: 'Missing webhook payload.' });
    }
    const event = JSON.parse(payload);
    const subscriptions = readSubscriptions();
    const customerEmail = event?.data?.object?.customer_email || event?.data?.object?.customer_details?.email || '';
    const plan = event?.data?.object?.metadata?.plan || 'pro';
    if (event.type === 'checkout.session.completed' || event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
      subscriptions[customerEmail || event.id] = {
        plan,
        status: 'active',
        updatedAt: new Date().toISOString()
      };
      writeSubscriptions(subscriptions);
    }
    res.json({ received: true, event: event.type });
  } catch (error) {
    console.error('Webhook handling failed:', error);
    res.status(400).json({ error: error.message || 'Invalid webhook payload.' });
  }
});

app.get('/api/subscriptions', (_req, res) => {
  res.json(readSubscriptions());
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(port, () => {
  console.log(`AI Hair Architect backend listening on http://127.0.0.1:${port}`);
});
