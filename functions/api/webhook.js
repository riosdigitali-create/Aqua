// Cloudflare Pages Function  ->  /api/webhook
// Mercado Pago envía aquí el aviso cuando se procesa un pago.
// Al quedar "approved" genera automáticamente la guía en Envia.com.
//
// Variables requeridas: MP_ACCESS_TOKEN, ENVIA_TOKEN
// Datos del remitente: ver ORIGIN abajo (mismos que quote.js).

const ORIGIN = {
  name: 'Aquamid',
  company: 'Aquamid',
  email: 'contacto@antisarro.shop',
  phone: '9997221998',
  street: 'Calle 71 A',
  number: '951',
  district: 'Nva Mulsay',
  city: 'Merida',
  state: 'YU',
  country: 'MX',
  postalCode: '97246'
};

const BOX = { weightPerUnitKg: 1, length: 20, width: 12, height: 12 };

export async function onRequest(context) {
  const { request, env } = context;
  try {
    const url = new URL(request.url);
    let paymentId =
      url.searchParams.get('data.id') ||
      url.searchParams.get('id');
    const topic = url.searchParams.get('topic') || url.searchParams.get('type');

    if (request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      paymentId = paymentId || body?.data?.id || body?.id;
    }

    if ((topic === 'payment' || topic === null) && paymentId && env.MP_ACCESS_TOKEN) {
      const r = await fetch('https://api.mercadopago.com/v1/payments/' + paymentId, {
        headers: { 'Authorization': 'Bearer ' + env.MP_ACCESS_TOKEN }
      });
      const pay = await r.json();

      if (pay.status === 'approved') {
        console.log('Pago aprobado', paymentId, JSON.stringify(pay.metadata || {}));
        if (env.ENVIA_TOKEN) {
          await generarGuia(env, pay).catch(e => console.log('Error guía:', String(e)));
        }
      }
    }
    return new Response('ok', { status: 200 });
  } catch (e) {
    // Responder 200 siempre para que Mercado Pago no reintente en bucle.
    return new Response('ok', { status: 200 });
  }
}

async function generarGuia(env, pay) {
  const m = pay.metadata || {};
  const c = m.customer || {};
  const qty = Math.max(1, parseInt(c.qty) || 1);
  const carrier = String(m.carrier || '').toLowerCase().replace(/[^a-z]/g, '');

  const payload = {
    origin: ORIGIN,
    destination: {
      name: c.name || pay.payer?.first_name || 'Cliente',
      company: '',
      email: c.email || pay.payer?.email || '',
      phone: String(c.phone || pay.payer?.phone?.number || '0000000000'),
      street: c.street || '-',
      number: c.number || 'S/N',
      district: c.district || c.colonia || '-',
      city: c.city || '-',
      state: c.state || '-',
      country: 'MX',
      postalCode: String(c.zip || '').replace(/\D/g, '').slice(0, 5),
      reference: c.reference || ''
    },
    packages: [{
      content: 'AQUAMID Anti Sarro',
      amount: qty,
      type: 'box',
      weight: BOX.weightPerUnitKg * qty,
      insurance: 0,
      declaredValue: Number(pay.transaction_amount) || 299,
      weightUnit: 'KG',
      lengthUnit: 'CM',
      dimensions: { length: BOX.length, width: BOX.width, height: BOX.height }
    }],
    shipment: { carrier: carrier || 'estafeta', type: 1 },
    settings: { printFormat: 'PDF', printSize: 'STOCK_4X6', comments: 'Pedido MP ' + pay.id }
  };

  const res = await fetch('https://api.envia.com/ship/generate/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + env.ENVIA_TOKEN },
    body: JSON.stringify(payload)
  });
  const out = await res.json();
  console.log('Guía Envia:', res.status, JSON.stringify(out).slice(0, 800));
  return out;
}
