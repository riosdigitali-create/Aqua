// Cloudflare Pages Function  ->  POST /api/quote
// Cotiza el envío con Envia.com según el C.P. de destino.
//
// Variable de entorno requerida (Cloudflare > Pages > Settings > Variables and secrets):
//   ENVIA_TOKEN  -> token de API de PRODUCCIÓN de la cuenta Envia.com
//
// Los datos del remitente están abajo en ORIGIN (no son secretos).

export const ORIGIN = {
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
  postalCode: '97246',
  reference: ''
};

// Caja y peso reales del producto
export const BOX = {
  weightPerUnitKg: 1,
  length: 20,
  width: 12,
  height: 12
};

const PACK_PRICES = [
  { units: 1, total: 299 },
  { units: 3, total: 497 },
  { units: 6, total: 597 },
  { units: 9, total: 697 }
];

function productTotal(qty) {
  let best = Infinity;
  for (const pack of PACK_PRICES) {
    best = Math.min(best, qty <= pack.units ? pack.total : Math.round(qty * (pack.total / pack.units)));
  }
  return best;
}

export async function onRequestOptions() {
  return cors(new Response(null, { status: 204 }));
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json().catch(() => ({}));
    const cp = String(body.cp || '').replace(/\D/g, '').slice(0, 5);
    const qty = Math.max(1, parseInt(body.qty) || 1);
    if (cp.length !== 5) return json({ error: 'C.P. inválido' }, 400);

    const TOKEN = env.ENVIA_TOKEN;
    // En producción nunca inventamos una tarifa: sin token se detiene el checkout.
    if (!TOKEN) return json({ error: 'El servicio de envíos no está configurado.' }, 503);

    const payload = {
      origin: {
        name: ORIGIN.name,
        company: ORIGIN.company,
        email: ORIGIN.email,
        phone: ORIGIN.phone,
        street: ORIGIN.street,
        number: ORIGIN.number,
        district: ORIGIN.district,
        city: ORIGIN.city,
        state: ORIGIN.state,
        country: ORIGIN.country,
        postalCode: ORIGIN.postalCode
      },
      destination: {
        name: 'Cliente',
        street: '-',
        number: '-',
        district: '-',
        city: '-',
        state: '-',
        country: 'MX',
        postalCode: cp,
        phone: '0000000000',
        email: 'cliente@antisarro.shop'
      },
      packages: [{
        content: 'AQUAMID Anti Sarro',
        amount: qty,
        type: 'box',
        weight: BOX.weightPerUnitKg * qty,
        insurance: 0,
        declaredValue: productTotal(qty),
        weightUnit: 'KG',
        lengthUnit: 'CM',
        dimensions: { length: BOX.length, width: BOX.width, height: BOX.height }
      }],
      shipment: { type: 1 },
      settings: { currency: 'MXN' }
    };

    // Envia falla si mandas carrier vacío. Cotizamos con las paqueterías principales
    // en paralelo y juntamos todos los resultados.
    const CARRIERS = ['estafeta', 'fedex', 'dhl', 'redpack', 'paquetexpress'];
    const calls = CARRIERS.map(c =>
      fetch('https://api.envia.com/ship/rate/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN },
        body: JSON.stringify({ ...payload, shipment: { type: 1, carrier: c } })
      }).then(res => res.json()).catch(() => null)
    );
    const results = await Promise.all(calls);

    const list = [];
    const errors = [];
    for (const data of results) {
      if (Array.isArray(data?.data)) list.push(...data.data);
      else if (data?.error) errors.push(data.error.message || data.error.description);
    }

    const all = list.map((x, i) => {
      const carrierRaw = String(x.carrier || x.carrierName || 'paqueteria').toLowerCase();
      const serviceRaw = String(x.service || x.serviceName || '').toLowerCase();
      return {
        id: carrierRaw + '-' + (x.serviceId ?? x.rate_id ?? x.id ?? i),
        carrierId: carrierRaw,
        serviceId: serviceRaw,
        carrier: CARRIER_NAME[carrierRaw] || cap(carrierRaw),
        service: serviceLabel(serviceRaw),
        price: Math.ceil(Number(x.totalPrice ?? x.total_amount ?? x.amount ?? 0)),
        days: parseDays(x.deliveryEstimate),
        eta: cleanEta(x.deliveryEstimate)
      };
    }).filter(x => x.price > 0).sort((a, b) => a.price - b.price);

    // Una sola opción (la más barata) por paquetería, para no abrumar al cliente.
    const seen = new Set();
    const rates = all.filter(x => {
      if (seen.has(x.carrierId)) return false;
      seen.add(x.carrierId);
      return true;
    }).slice(0, 4);

    if (!rates.length) {
      return json({
        error: 'Envia no devolvió tarifas para ese destino.',
        detail: errors.slice(0, 3)
      }, 502);
    }
    return json({ rates });
  } catch (e) {
    return json({ error: 'No se pudo cotizar el envío.', detail: String(e) }, 502);
  }
}

const CARRIER_NAME = {
  estafeta: 'Estafeta',
  fedex: 'FedEx',
  dhl: 'DHL',
  redpack: 'Redpack',
  paquetexpress: 'Paquetexpress'
};

function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

function serviceLabel(s) {
  if (!s) return 'Estándar';
  if (s.includes('express_1030') || s.includes('express_1200')) return 'Express (hora fija)';
  if (s.includes('express')) return 'Express';
  if (s.includes('ground') || s.includes('terrestre')) return 'Terrestre';
  if (s.includes('economy') || s.includes('economico')) return 'Económico';
  if (s.includes('next') || s.includes('day')) return 'Día siguiente';
  return cap(s.replace(/_/g, ' '));
}

function parseDays(est) {
  const m = String(est || '').match(/(\d+)\s*-\s*(\d+)/);
  if (m) return Number(m[2]);
  const one = String(est || '').match(/(\d+)/);
  if (one) return Number(one[1]);
  return 3;
}

function cleanEta(est) {
  const s = String(est || '').trim();
  if (!s) return '3 a 5 días hábiles';
  if (/siguiente/i.test(s)) return 'Día siguiente hábil';
  const m = s.match(/(\d+)\s*-\s*(\d+)/);
  if (m) return `${m[1]} a ${m[2]} días hábiles`;
  const one = s.match(/^(\d+)/);
  if (one) return `${one[1]} días hábiles`;
  return s;
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
