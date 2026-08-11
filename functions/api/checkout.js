// Cloudflare Pages Function  ->  POST /api/checkout
// Crea una preferencia de pago en Mercado Pago (Checkout Pro) y devuelve el link.
// Checkout Pro acepta tarjeta, OXXO (efectivo), SPEI (transferencia) y saldo MP.
// Variables de entorno (Cloudflare > Pages > Settings > Environment variables):
//   MP_ACCESS_TOKEN -> Access Token de PRODUCCIÓN de Mercado Pago
//                      (Tus integraciones > tu app > Credenciales de producción)

const ORIGIN = {
  name: 'Aquamid', company: 'Aquamid', email: 'contacto@antisarro.shop',
  phone: '9997221998', street: 'Calle 71 A', number: '951', district: 'Nva Mulsay',
  city: 'Merida', state: 'YU', country: 'MX', postalCode: '97246'
};
const BOX = { weightPerUnitKg: 1, length: 20, width: 12, height: 12 };
const PACK_PRICES = [
  { units: 1, total: 299 }, { units: 3, total: 497 },
  { units: 6, total: 597 }, { units: 9, total: 697 }
];
const STATE_CODES = {
  aguascalientes:'AG', bajacalifornia:'BC', bajacaliforniasur:'BS', campeche:'CM',
  chiapas:'CS', chihuahua:'CH', cdmx:'CX', ciudaddemexico:'CX', coahuila:'CO',
  colima:'CL', durango:'DG', guanajuato:'GT', guerrero:'GR', hidalgo:'HG',
  jalisco:'JA', estadodemexico:'EM', mexico:'EM', michoacan:'MI', morelos:'MO',
  nayarit:'NA', nuevoleon:'NL', oaxaca:'OA', puebla:'PU', queretaro:'QT',
  quintanaroo:'QR', sanluispotosi:'SL', sinaloa:'SI', sonora:'SO', tabasco:'TB',
  tamaulipas:'TM', tlaxcala:'TL', veracruz:'VE', yucatan:'YU', zacatecas:'ZA'
};

export async function onRequestOptions() {
  return cors(new Response(null, { status: 204 }));
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const TOKEN = env.MP_ACCESS_TOKEN;
  if (!TOKEN) return json({ error: 'Falta MP_ACCESS_TOKEN en Cloudflare' }, 500);

  try {
    const b = await request.json().catch(() => ({}));
    const qty = Math.max(1, Math.min(99, parseInt(b.qty) || 1));
    const productTotal = priceFor(qty);
    const carrier = String(b.carrier || 'Envío').trim();
    const carrierId = cleanId(b.carrierId);
    const serviceId = cleanId(b.serviceId);
    const customer = normalizeCustomer(b);
    if (!env.ENVIA_TOKEN) fail('Falta ENVIA_TOKEN en Cloudflare', 503);
    if (!carrierId || !serviceId) fail('La tarifa seleccionada no tiene carrier/service de Envia.', 400);
    validateCustomer(customer);
    const quotedShipping = await quoteSelectedShipping(env, customer, qty, productTotal, carrierId, serviceId);
    const shippingCost = qty >= 6 ? 0 : Math.ceil(quotedShipping);
    const origin = new URL(request.url).origin;
    const orderId = 'AQM-' + crypto.randomUUID();

    const items = [
      { title: qty + ' x AQUAMID DUAL Anti Sarro', quantity: 1, unit_price: productTotal, currency_id: 'MXN' }
    ];
    if (shippingCost > 0) {
      items.push({ title: 'Envío (' + carrier + ')', quantity: 1, unit_price: shippingCost, currency_id: 'MXN' });
    }

    const preference = {
      items,
      payer: {
        name: customer.name,
        email: customer.email,
        phone: { number: customer.phone }
      },
      shipments: {
        receiver_address: {
          zip_code: customer.zip,
          street_name: customer.street,
          street_number: customer.number,
          city_name: customer.city,
          state_name: customer.state
        }
      },
      back_urls: {
        success: origin + '/gracias.html',
        failure: origin + '/gracias.html',
        pending: origin + '/gracias.html'
      },
      auto_return: 'approved',
      statement_descriptor: 'AQUAMID',
      external_reference: orderId,
      metadata: {
        order_id: orderId, qty, product_total: productTotal,
        shipping_cost: shippingCost, carrier, carrier_id: carrierId, service_id: serviceId,
        customer_name: customer.name, customer_email: customer.email, customer_phone: customer.phone,
        street: customer.street, number: customer.number, district: customer.district,
        city: customer.city, state: customer.state, zip: customer.zip
      },
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
    return json({ error: e && e.message ? e.message : String(e) }, e && e.status ? e.status : 500);
  }
}

function priceFor(qty) {
  let best = Infinity;
  for (const pack of PACK_PRICES) {
    best = Math.min(best, qty <= pack.units ? pack.total : Math.round(qty * (pack.total / pack.units)));
  }
  return best;
}

function cleanId(value) {
  const id = String(value || '').trim().toLowerCase();
  return /^[a-z0-9_-]{1,60}$/.test(id) ? id : '';
}

function normalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '');
}

function stateCode(value) {
  const raw = String(value || '').trim();
  return STATE_CODES[normalize(raw)] || raw;
}

function normalizeCustomer(b) {
  return {
    name: String(b.name || '').trim(), email: String(b.email || '').trim(),
    phone: String(b.phone || '').replace(/\D/g, '').slice(-10),
    street: String(b.street || '').trim(), number: String(b.number || '').trim(),
    district: String(b.district || b.hood || '').trim(), city: String(b.city || '').trim(),
    state: stateCode(b.state), zip: String(b.zip || '').replace(/\D/g, '').slice(0, 5)
  };
}

function validateCustomer(c) {
  if (c.name.length < 3) fail('Nombre de envío inválido.', 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) fail('Correo de envío inválido.', 400);
  if (c.phone.length !== 10) fail('Teléfono de envío inválido.', 400);
  if (!c.street || !c.number || !c.district || !c.city || !c.state || c.zip.length !== 5) {
    fail('La dirección de envío está incompleta.', 400);
  }
}

async function quoteSelectedShipping(env, c, qty, declaredValue, carrier, service) {
  const payload = {
    origin: ORIGIN,
    destination: {
      name: c.name, company: '', email: c.email, phone: c.phone,
      street: c.street, number: c.number, district: c.district,
      city: c.city, state: c.state, country: 'MX', postalCode: c.zip
    },
    packages: [{
      content: 'AQUAMID Anti Sarro', amount: qty, type: 'box',
      weight: BOX.weightPerUnitKg * qty, insurance: 0, declaredValue,
      weightUnit: 'KG', lengthUnit: 'CM',
      dimensions: { length: BOX.length, width: BOX.width, height: BOX.height }
    }],
    shipment: { type: 1, carrier, service },
    settings: { currency: 'MXN' }
  };
  const response = await fetch('https://api.envia.com/ship/rate/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + env.ENVIA_TOKEN },
    body: JSON.stringify(payload)
  });
  const out = await response.json().catch(() => ({}));
  const rates = Array.isArray(out && out.data) ? out.data : [];
  const exact = rates.find(rate => String(rate.carrier || '').toLowerCase() === carrier && String(rate.service || '').toLowerCase() === service);
  const price = Number((exact || rates[0] || {}).totalPrice);
  if (!response.ok || !Number.isFinite(price) || price <= 0) fail('Envia rechazó la tarifa seleccionada. Elige otra paquetería.', 502);
  return price;
}

function fail(message, status) {
  const error = new Error(message);
  error.status = status;
  throw error;
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
