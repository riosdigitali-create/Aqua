// Cloudflare Pages Function  ->  GET /api/pedidos
// Panel de envíos: consulta la Queries API de Envia.com y devuelve los envíos
// del mes. Sustituye el acceso al panel de envia.com (que aquí no se tiene).
//
// Variables de entorno requeridas (Cloudflare > Pages > Settings > Variables):
//   ENVIA_TOKEN -> el mismo token que ya usan quote.js y webhook.js
//   PANEL_KEY   -> contraseña del panel. Sin ella el endpoint NO responde.
//
// Endpoints de Envia usados (Queries API, producción):
//   GET https://queries.envia.com/guide/{MM}/{YYYY}   -> lista del mes
//   GET https://queries.envia.com/guide/{tracking}    -> detalle de un envío
//
// Parámetros:
//   ?mes=08&anio=2026   por defecto, el mes en curso
//   ?detalle=0          omite el enriquecido (más rápido, sin dirección)
//   ?raw=1              devuelve la respuesta cruda de Envia (para depurar)

const QUERIES = 'https://queries.envia.com';
const MAX_DETALLE = 40;   // tope de llamadas de detalle por carga
const LOTE = 5;           // detalles en paralelo por tanda

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // ---- Puerta: sin PANEL_KEY configurada, el endpoint queda cerrado ----
  if (!env.PANEL_KEY) {
    return json({ error: 'Falta PANEL_KEY en Cloudflare. El panel está deshabilitado.' }, 503);
  }
  const key = request.headers.get('x-panel-key') || url.searchParams.get('key') || '';
  if (key !== env.PANEL_KEY) {
    return json({ error: 'Clave incorrecta.' }, 401);
  }
  if (!env.ENVIA_TOKEN) {
    return json({ error: 'Falta ENVIA_TOKEN en Cloudflare.' }, 503);
  }

  const ahora = new Date();
  const mes = String(url.searchParams.get('mes') || (ahora.getUTCMonth() + 1)).padStart(2, '0');
  const anio = String(url.searchParams.get('anio') || ahora.getUTCFullYear());
  if (!/^(0[1-9]|1[0-2])$/.test(mes) || !/^[0-9]{4}$/.test(anio)) {
    return json({ error: 'Mes o año inválidos.' }, 400);
  }

  try {
    const res = await fetch(`${QUERIES}/guide/${mes}/${anio}`, { headers: cabeceras(env) });
    const out = await res.json().catch(() => ({}));

    if (url.searchParams.get('raw') === '1') {
      return json({ status: res.status, raw: out });
    }
    if (!res.ok) {
      return json({ error: 'Envia rechazó la consulta (HTTP ' + res.status + ')', detalle: recorta(out) }, 502);
    }

    let envios = normalizaLista(out).map(fila);

    if (url.searchParams.get('detalle') !== '0') {
      envios = await enriquece(env, envios);
    }

    envios.sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
    return json({ mes, anio, total: envios.length, envios });
  } catch (e) {
    return json({ error: 'No se pudo consultar Envia.', detalle: String(e && e.message || e) }, 502);
  }
}

function cabeceras(env) {
  return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + env.ENVIA_TOKEN };
}

/* La Queries API ha devuelto la lista en varias formas según versión//cuenta.
   Se aceptan todas en vez de asumir una sola y romperse. */
function normalizaLista(out) {
  if (Array.isArray(out)) return out;
  if (Array.isArray(out?.data)) return out.data;
  if (Array.isArray(out?.data?.data)) return out.data.data;
  if (Array.isArray(out?.data?.items)) return out.data.items;
  if (Array.isArray(out?.items)) return out.items;
  if (Array.isArray(out?.guides)) return out.guides;
  if (Array.isArray(out?.shipments)) return out.shipments;
  return [];
}

const v = (o, ...llaves) => {
  for (const k of llaves) {
    const val = k.split('.').reduce((a, p) => (a == null ? a : a[p]), o);
    if (val !== undefined && val !== null && val !== '') return val;
  }
  return '';
};

function fila(x) {
  return {
    guia: String(v(x, 'tracking_number', 'trackingNumber', 'tracking', 'guide', 'number')),
    paqueteria: String(v(x, 'carrier', 'carrier_name', 'carrierName', 'carrier.name')),
    servicio: String(v(x, 'service', 'service_name', 'serviceName')),
    estado: String(v(x, 'status', 'status_name', 'statusName', 'state')),
    fecha: String(v(x, 'created_at', 'createdAt', 'date', 'creation_date')),
    costo: Number(v(x, 'total_price', 'totalPrice', 'amount', 'price')) || null,
    etiqueta: String(v(x, 'label', 'label_url', 'labelUrl', 'url', 'pdf')),
    cliente: String(v(x, 'destination.name', 'receiver_name', 'destination_name')),
    direccion: '',
    telefono: String(v(x, 'destination.phone', 'receiver_phone')),
    referencia: String(v(x, 'comments', 'reference', 'comment')),
    _crudo: undefined
  };
}

/* La lista del mes viene resumida: trae guía, paquetería y estado pero no
   la dirección. El detalle por guía sí la trae, así que se completan en tandas. */
async function enriquece(env, envios) {
  const objetivo = envios.slice(0, MAX_DETALLE);
  for (let i = 0; i < objetivo.length; i += LOTE) {
    const tanda = objetivo.slice(i, i + LOTE);
    await Promise.all(tanda.map(async (e) => {
      if (!e.guia) return;
      try {
        const r = await fetch(`${QUERIES}/guide/${encodeURIComponent(e.guia)}`, { headers: cabeceras(env) });
        if (!r.ok) return;
        const d = await r.json().catch(() => ({}));
        const o = d?.data?.[0] || d?.data || d || {};
        const dest = o.destination || o.receiver || {};
        e.cliente = e.cliente || String(v(dest, 'name') || v(o, 'receiver_name'));
        e.telefono = e.telefono || String(v(dest, 'phone'));
        e.correo = String(v(dest, 'email'));
        e.direccion = [
          v(dest, 'street'), v(dest, 'number'), v(dest, 'district', 'colony'),
          v(dest, 'city'), v(dest, 'state'), v(dest, 'postalCode', 'postal_code', 'zip_code')
        ].filter(Boolean).join(', ');
        e.referencia = e.referencia || String(v(o, 'comments', 'reference'));
        e.etiqueta = e.etiqueta || String(v(o, 'label', 'label_url', 'url'));
        e.costo = e.costo || Number(v(o, 'total_price', 'totalPrice', 'amount')) || null;
      } catch (_) { /* un detalle que falle no tumba la tabla */ }
    }));
  }
  return envios;
}

function recorta(o) { return JSON.stringify(o || {}).slice(0, 600); }

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow'
    }
  });
}
