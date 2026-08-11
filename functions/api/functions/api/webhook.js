// Cloudflare Pages Function -> /api/webhook
// Mercado Pago notifica un pago; al quedar approved se genera la guía real en Envia.
// Variables requeridas: MP_ACCESS_TOKEN, ENVIA_TOKEN.

const ORIGIN = {
  name: 'Aquamid', company: 'Aquamid', email: 'contacto@antisarro.shop',
  phone: '9997221998', street: 'Calle 71 A', number: '951', district: 'Nva Mulsay',
  city: 'Merida', state: 'YU', country: 'MX', postalCode: '97246'
};
const BOX = { weightPerUnitKg: 1, length: 20, width: 12, height: 12 };
const KNOWN_CARRIERS = ['estafeta', 'fedex', 'dhl', 'redpack', 'paquetexpress'];
const STATE_CODES = {
  aguascalientes:'AG', bajacalifornia:'BC', bajacaliforniasur:'BS', campeche:'CM',
  chiapas:'CS', chihuahua:'CH', cdmx:'CX', ciudaddemexico:'CX', coahuila:'CO',
  colima:'CL', durango:'DG', guanajuato:'GT', guerrero:'GR', hidalgo:'HG',
  jalisco:'JA', estadodemexico:'EM', mexico:'EM', michoacan:'MI', morelos:'MO',
  nayarit:'NA', nuevoleon:'NL', oaxaca:'OA', puebla:'PU', queretaro:'QT',
  quintanaroo:'QR', sanluispotosi:'SL', sinaloa:'SI', sonora:'SO', tabasco:'TB',
  tamaulipas:'TM', tlaxcala:'TL', veracruz:'VE', yucatan:'YU', zacatecas:'ZA'
};

export async function onRequest({ request, env }) {
  // Ruta de salud. Nunca genera una guía mediante GET.
  if (request.method !== 'POST') return new Response('ok', { status: 200 });

  try {
    const url = new URL(request.url);
    const body = await request.json().catch(() => ({}));
    const paymentId = String(
      url.searchParams.get('data.id') || url.searchParams.get('id') || body?.data?.id || body?.id || ''
    ).trim();
    const topic = url.searchParams.get('topic') || url.searchParams.get('type') || body?.type || null;

    if (topic && topic !== 'payment') return new Response('ok', { status: 200 });
    if (!paymentId) return new Response('ok', { status: 200 });
    if (!env.MP_ACCESS_TOKEN || !env.ENVIA_TOKEN) throw new Error('Faltan secretos MP_ACCESS_TOKEN/ENVIA_TOKEN');

    if (await wasProcessed(request, paymentId)) return new Response('ok', { status: 200 });

    const paymentResponse = await fetch('https://api.mercadopago.com/v1/payments/' + encodeURIComponent(paymentId), {
      headers: { 'Authorization': 'Bearer ' + env.MP_ACCESS_TOKEN }
    });
    const payment = await paymentResponse.json().catch(() => ({}));
    if (!paymentResponse.ok) throw new Error('Mercado Pago no devolvió el pago: HTTP ' + paymentResponse.status);
    if (payment.status !== 'approved') return new Response('ok', { status: 200 });

    const guide = await generateLabel(env, payment);
    await markProcessed(request, paymentId, guide);
    console.log('Guía creada para pago', paymentId, guide.trackingNumber || 'sin tracking');
    return new Response('ok', { status: 200 });
  } catch (error) {
    // Un 5xx hace que Mercado Pago reintente; no confirmamos como procesado un envío fallido.
    console.error('Webhook no procesado:', error && error.message ? error.message : String(error));
    return new Response('error', { status: 500 });
  }
}

async function generateLabel(env, payment) {
  const metadata = payment.metadata || {};
  const oldCustomer = metadata.customer || {};
  const customer = {
    qty: metadata.qty ?? oldCustomer.qty,
    name: metadata.customer_name || oldCustomer.name || payment.payer?.first_name || '',
    email: metadata.customer_email || oldCustomer.email || payment.payer?.email || '',
    phone: metadata.customer_phone || oldCustomer.phone || payment.payer?.phone?.number || '',
    street: metadata.street || oldCustomer.street || '',
    number: metadata.number || oldCustomer.number || '',
    district: metadata.district || oldCustomer.district || oldCustomer.colonia || oldCustomer.hood || '',
    city: metadata.city || oldCustomer.city || '',
    state: metadata.state || oldCustomer.state || '',
    zip: metadata.zip || oldCustomer.zip || ''
  };
  splitLegacyAddress(customer);
  customer.phone = String(customer.phone || '').replace(/\D/g, '').slice(-10);
  customer.zip = String(customer.zip || '').replace(/\D/g, '').slice(0, 5);
  customer.state = stateCode(customer.state);

  const qty = Math.max(1, parseInt(customer.qty) || 1);
  validateCustomer(customer);

  const carrierSource = metadata.carrier_id || metadata.carrierId || metadata.carrier || '';
  const carrier = carrierId(carrierSource);
  let service = cleanId(metadata.service_id || metadata.serviceId);
  if (!carrier) throw new Error('El pago no contiene una paquetería válida');

  const shippingCost = Number(metadata.shipping_cost ?? metadata.shippingCost ?? 0) || 0;
  const declaredValue = Math.max(1, Number(metadata.product_total) || (Number(payment.transaction_amount) - shippingCost) || 299);
  const payload = {
    origin: ORIGIN,
    destination: {
      name: customer.name, company: '', email: customer.email, phone: customer.phone,
      street: customer.street, number: customer.number, district: customer.district,
      city: customer.city, state: customer.state, country: 'MX', postalCode: customer.zip,
      reference: String(metadata.reference || oldCustomer.reference || '')
    },
    packages: [{
      content: 'AQUAMID Anti Sarro', amount: qty, type: 'box',
      weight: BOX.weightPerUnitKg * qty, insurance: 0, declaredValue,
      weightUnit: 'KG', lengthUnit: 'CM',
      dimensions: { length: BOX.length, width: BOX.width, height: BOX.height }
    }],
    shipment: { carrier, service, type: 1 },
    settings: {
      printFormat: 'PDF', printSize: 'STOCK_4X6',
      comments: 'Pedido MP ' + payment.id
    }
  };

  // Compatibilidad con pagos hechos antes del arreglo: se vuelve a cotizar el
  // carrier elegido para recuperar el service exacto que antes se descartaba.
  if (!service) service = await resolveService(env, payload, carrier);
  payload.shipment.service = service;

  const response = await fetch('https://api.envia.com/ship/generate/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + env.ENVIA_TOKEN },
    body: JSON.stringify(payload)
  });
  const out = await response.json().catch(() => ({}));
  const guide = Array.isArray(out && out.data) ? out.data[0] : null;
  if (!response.ok || !guide || !guide.trackingNumber) {
    const detail = out?.error?.message || out?.error?.description || out?.message || 'respuesta sin tracking';
    throw new Error('Envia rechazó la guía (HTTP ' + response.status + '): ' + detail);
  }
  return guide;
}

async function resolveService(env, payload, carrier) {
  const quotePayload = {
    ...payload,
    shipment: { type: 1, carrier },
    settings: { currency: 'MXN' }
  };
  const response = await fetch('https://api.envia.com/ship/rate/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + env.ENVIA_TOKEN },
    body: JSON.stringify(quotePayload)
  });
  const out = await response.json().catch(() => ({}));
  const rates = Array.isArray(out && out.data) ? out.data : [];
  rates.sort((a, b) => Number(a.totalPrice || Infinity) - Number(b.totalPrice || Infinity));
  const service = cleanId(rates[0]?.service);
  if (!response.ok || !service) throw new Error('No se pudo recuperar el servicio de Envia para el pago anterior');
  return service;
}

function splitLegacyAddress(customer) {
  if (customer.number || !customer.street) return;
  const match = String(customer.street).match(/^(.*?)(?:,|\s+#|\s+no\.?\s+)\s*([\w-]+(?:\s+int\.?\s*[\w-]+)?)$/i);
  if (match) {
    customer.street = match[1].trim();
    customer.number = match[2].trim();
  } else {
    customer.number = 'S/N';
  }
}

function validateCustomer(c) {
  if (!c.name || !c.street || !c.number || !c.district || !c.city || !c.state || c.zip.length !== 5) {
    throw new Error('La dirección guardada en Mercado Pago está incompleta');
  }
  if (c.phone.length !== 10) throw new Error('El teléfono guardado en Mercado Pago no tiene 10 dígitos');
}

function normalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '');
}

function stateCode(value) {
  const raw = String(value || '').trim();
  return STATE_CODES[normalize(raw)] || raw;
}

function cleanId(value) {
  const id = String(value || '').trim().toLowerCase();
  return /^[a-z0-9_-]{1,60}$/.test(id) ? id : '';
}

function carrierId(value) {
  const exact = cleanId(value);
  if (KNOWN_CARRIERS.includes(exact)) return exact;
  const normalized = normalize(value);
  return KNOWN_CARRIERS.find(carrier => normalized.includes(carrier)) || '';
}

function processedKey(request, paymentId) {
  const url = new URL(request.url);
  return new Request(url.origin + '/api/.processed/payment-' + encodeURIComponent(paymentId), { method: 'GET' });
}

async function wasProcessed(request, paymentId) {
  try { return Boolean(await caches.default.match(processedKey(request, paymentId))); }
  catch (_) { return false; }
}

async function markProcessed(request, paymentId, guide) {
  try {
    const response = new Response(JSON.stringify({
      paymentId, trackingNumber: guide.trackingNumber, shipmentId: guide.shipmentId || null
    }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=2592000' }
    });
    await caches.default.put(processedKey(request, paymentId), response);
  } catch (error) {
    console.error('No se pudo guardar la marca idempotente:', error && error.message ? error.message : String(error));
  }
}
