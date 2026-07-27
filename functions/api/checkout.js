// Cloudflare Pages Function  ->  POST /api/checkout
// Crea una preferencia de pago en Mercado Pago (Checkout Pro) y devuelve el link.
// Checkout Pro acepta tarjeta, OXXO (efectivo), SPEI (transferencia) y saldo MP.
// Variables de entorno (Cloudflare > Pages > Settings > Environment variables):
//   MP_ACCESS_TOKEN -> Access Token de PRODUCCIÓN de Mercado Pago
//                      (Tus integraciones > tu app > Credenciales de producción)

export async function onRequestOptions() {
  return cors(new Response(null, { status: 204 }));
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const TOKEN = env.MP_ACCESS_TOKEN;
  if (!TOKEN) return json({ error: 'Falta MP_ACCESS_TOKEN en Cloudflare' }, 500);

  try {
    const b = await request.json().catch(() => ({}));
    const qty = Math.max(1, parseInt(b.qty) || 1);
    const unit = Number(b.unitPrice || 299);
    const shippingCost = Math.max(0, Number(b.shipping || 0));
    const carrier = b.carrier || 'Envío';
    const origin = new URL(request.url).origin;

    const items = [
      { title: 'AQUAMID DUAL Anti Sarro', quantity: qty, unit_price: unit, currency_id: 'MXN' }
    ];
    if (shippingCost > 0) {
      items.push({ title: 'Envío (' + carrier + ')', quantity: 1, unit_price: shippingCost, currency_id: 'MXN' });
    }

    const preference = {
      items,
      payer: {
        name: b.name || '',
        email: b.email || '',
        phone: b.phone ? { number: String(b.phone) } : undefined
      },
      shipments: {
        receiver_address: {
          zip_code: b.zip || '',
          street_name: b.street || '',
          city_name: b.city || '',
          state_name: b.state || ''
        }
      },
      back_urls: {
        success: origin + '/gracias.html',
        failure: origin + '/gracias.html',
        pending: origin + '/gracias.html'
      },
      auto_return: 'approved',
      statement_descriptor: 'AQUAMID',
      metadata: { customer: b, carrier, shippingCost },
      notification_url: origin + '/api/webhook'
    };

    const r = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN },
      body: JSON.stringify(preference)
    });
    const data = await r.json();
    if (!data.init_point) return json({ error: 'Mercado Pago no devolvió init_point', detail: data }, 502);

    return json({ init_point: data.init_point, id: data.id });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
}

function json(obj, status = 200) {
  return cors(new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } }));
}
function cors(res) {
  res.headers.set('Access-Control-Allow-Origin', '*');
  res.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return res;
}
