// Cloudflare Pages Function  ->  POST /api/quote
// Cotiza el envío con Envia.com según el C.P. de destino.
// Variables de entorno (Cloudflare > Pages > Settings > Environment variables):
//   ENVIA_TOKEN   -> token de API de tu cuenta Envia.com
//   ORIGIN_CP     -> C.P. desde donde envías (ej. 97000)
//   ORIGIN_NAME   -> nombre del remitente (opcional)

export async function onRequestOptions() {
  return cors(new Response(null, { status: 204 }));
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json().catch(() => ({}));
    const cp = String(body.cp || '').replace(/\D/g, '').slice(0, 5);
    const qty = Math.max(1, parseInt(body.qty) || 1);
    const unit = Number(body.unitPrice || 299);
    if (cp.length !== 5) return json({ error: 'C.P. inválido' }, 400);

    const TOKEN = env.ENVIA_TOKEN;
    const ORIGIN_CP = env.ORIGIN_CP || '97000';
    // Sin token todavía -> devolvemos tarifas de ejemplo para que la tienda funcione.
    if (!TOKEN) return json({ rates: fallbackRates(), fallback: true });

    const payload = {
      origin: { country_code: 'MX', postal_code: ORIGIN_CP },
      destination: { country_code: 'MX', postal_code: cp },
      packages: [{
        content: 'AQUAMID Anti Sarro',
        amount: qty,
        type: 'box',
        weight: 1 * qty,          // kg por pieza (ajusta al peso real)
        weightUnit: 'KG',
        lengthUnit: 'CM',
        dimensions: { length: 20, width: 12, height: 12 }, // cm (ajusta a tu caja)
        declaredValue: unit * qty,
        insurance: 0
      }],
      shipment: { type: 1 }
    };

    const r = await fetch('https://api.envia.com/ship/rate/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN },
      body: JSON.stringify(payload)
    });
    const data = await r.json();

    // Envia devuelve la lista en data.data (mapeo defensivo por si cambian nombres)
    const list = Array.isArray(data?.data) ? data.data : [];
    const rates = list.map((x, i) => ({
      id: String(x.rate_id ?? x.id ?? i),
      carrier: x.carrier || x.carrierName || 'Paquetería',
      service: x.service || x.serviceDescription || x.serviceName || '',
      price: Math.ceil(Number(x.totalPrice ?? x.total_amount ?? x.amount ?? 0)),
      days: Number(x.deliveryEstimate ?? x.days ?? 3),
      eta: (x.deliveryEstimate ? (x.deliveryEstimate + ' días hábiles') : '3 a 5 días hábiles')
    })).filter(x => x.price > 0).sort((a, b) => a.price - b.price);

    if (!rates.length) return json({ rates: fallbackRates(), fallback: true, note: 'Sin tarifas de Envia; usando ejemplo.' });
    return json({ rates });
  } catch (e) {
    return json({ rates: fallbackRates(), fallback: true, error: String(e) });
  }
}

function fallbackRates() {
  return [
    { id: 'est', carrier: 'Estafeta', service: 'Terrestre', price: 99, days: 5, eta: '3 a 5 días hábiles' },
    { id: 'fdx', carrier: 'FedEx', service: 'Express', price: 159, days: 3, eta: '2 a 3 días hábiles' },
    { id: 'dhl', carrier: 'DHL', service: 'eCommerce', price: 229, days: 2, eta: '1 a 2 días hábiles' }
  ];
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
