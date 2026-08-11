/**
 * GET /api/cp?cp=97000
 * ---------------------------------------------------------------------------
 * Devuelve estado, municipio, ciudad y la lista de COLONIAS de un código
 * postal mexicano, para que el checkout autocomplete y obligue a elegir la
 * colonia correcta (menos direcciones mal escritas → menos devoluciones y
 * menos envíos perdidos).
 *
 * FUENTE: Geocodes de Envia.com — la MISMA empresa que entrega el paquete.
 *   https://geocodes.envia.com/zipcode/MX/{cp}
 *   · No pide token ni cuenta.
 *   · Responde en ~200 ms.
 *   · Trae la lista completa de colonias en `suburbs`
 *     (ej. C.P. 44100 → 25 colonias).
 *
 * Antes esto consultaba cuatro APIs comunitarias de SEPOMEX. Dos estaban
 * caídas (timeout y error 525), otra devolvía datos ALEATORIOS con su token
 * público de pruebas, y la única viva daba listas de 1 sola colonia. Aquello
 * tardaba hasta 24 s en pleno checkout. Esto es una sola llamada, rápida,
 * gratis y del proveedor que de verdad importa que valide la dirección.
 *
 * Respuesta:
 *   { ok:true, cp:"44100", estado:"Jalisco", municipio:"Guadalajara",
 *     ciudad:"Guadalajara", colonias:["Americana", ...], fuente:"envia" }
 *   { ok:false, cp, estado, colonias:[], error:"..." }
 *
 * Con ?debug=1 añade el detalle del intento y no usa caché.
 * ---------------------------------------------------------------------------
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/* prefijo (2 primeros dígitos) → estado. Rangos oficiales SEPOMEX.
   Sirve de red de seguridad: si Envia contesta un estado que no cuadra con
   el prefijo, descartamos la respuesta en vez de dar datos falsos. */
const CP_EDO = [
  [1, 16, 'CDMX'], [20, 20, 'Aguascalientes'], [21, 22, 'Baja California'],
  [23, 23, 'Baja California Sur'], [24, 24, 'Campeche'], [25, 27, 'Coahuila'],
  [28, 28, 'Colima'], [29, 30, 'Chiapas'], [31, 33, 'Chihuahua'],
  [34, 35, 'Durango'], [36, 38, 'Guanajuato'], [39, 41, 'Guerrero'],
  [42, 43, 'Hidalgo'], [44, 49, 'Jalisco'], [50, 57, 'Estado de México'],
  [58, 61, 'Michoacán'], [62, 62, 'Morelos'], [63, 63, 'Nayarit'],
  [64, 67, 'Nuevo León'], [68, 71, 'Oaxaca'], [72, 75, 'Puebla'],
  [76, 76, 'Querétaro'], [77, 77, 'Quintana Roo'], [78, 79, 'San Luis Potosí'],
  [80, 82, 'Sinaloa'], [83, 85, 'Sonora'], [86, 86, 'Tabasco'],
  [87, 89, 'Tamaulipas'], [90, 90, 'Tlaxcala'], [91, 96, 'Veracruz'],
  [97, 97, 'Yucatán'], [98, 99, 'Zacatecas'],
];

function estadoPorPrefijo(cp) {
  const p = parseInt(cp.slice(0, 2), 10);
  if (Number.isNaN(p)) return '';
  for (const [a, b, e] of CP_EDO) if (p >= a && p <= b) return e;
  return '';
}

const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                    .toLowerCase().replace(/[^a-z]/g, '');
const ALIAS = {
  ciudaddemexico: 'cdmx', distritofederal: 'cdmx', df: 'cdmx',
  mexico: 'estadodemexico', edomex: 'estadodemexico',
  veracruzdeignaciodelallave: 'veracruz', michoacandeocampo: 'michoacan',
  coahuiladezaragoza: 'coahuila',
};
const clave = s => { const k = norm(s); return ALIAS[k] || k; };

const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control':
        status === 200 && obj && obj.ok === true ? 'public, max-age=86400' : 'no-store',
      ...CORS,
      ...extra,
    },
  });

/* limpia, deduplica y ordena; descarta cadenas que no parezcan un nombre */
function limpiaColonias(lista) {
  const out = [];
  const vistos = new Set();
  for (const raw of lista) {
    const v = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!v) continue;
    if (!/[aeiouáéíóú]/i.test(v)) continue;
    if (!/^[\p{L}\p{N}\s.,'’\-/()]+$/u.test(v)) continue;
    const k = v.toLowerCase();
    if (vistos.has(k)) continue;
    vistos.add(k);
    out.push(v);
  }
  return out.sort((a, b) => a.localeCompare(b, 'es'));
}

/* La respuesta viene como objeto indexado ("0", "1", ...) y un mismo C.P.
   puede traer varias entradas; juntamos las colonias de todas. */
async function consultaEnvia(cp, ms = 4000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  let d;
  try {
    const r = await fetch(`https://geocodes.envia.com/zipcode/MX/${cp}`, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });
    if (!r.ok) throw new Error('http ' + r.status);
    d = await r.json();
  } finally {
    clearTimeout(t);
  }

  if (!d || d.success === false) throw new Error(d && d.message ? d.message : 'C.P. no encontrado');

  const filas = Object.keys(d)
    .filter(k => /^\d+$/.test(k))
    .map(k => d[k])
    .filter(Boolean);
  if (!filas.length) throw new Error('C.P. no encontrado');

  const colonias = [];
  let estado = '', municipio = '', ciudad = '';
  for (const f of filas) {
    estado    = estado    || (f.state && f.state.name) || '';
    ciudad    = ciudad    || f.locality || '';
    municipio = municipio || (f.regions && f.regions.region_2) || f.locality || '';
    if (Array.isArray(f.suburbs)) colonias.push(...f.suburbs);
    else if (f.suburbs) colonias.push(f.suburbs);
  }
  return { estado, municipio, ciudad, colonias, fuente: 'envia' };
}

/* ------------------------------- handler --------------------------------- */

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const cp = (url.searchParams.get('cp') || '').replace(/\D/g, '').slice(0, 5);

  if (cp.length !== 5) {
    return json({ ok: false, error: 'C.P. inválido: se esperan 5 dígitos.' }, 400);
  }

  const estadoLocal = estadoPorPrefijo(cp);
  if (!estadoLocal) {
    return json({ ok: false, cp, error: 'Ese C.P. no corresponde a ningún estado de México.' }, 404);
  }

  /* Caché del borde. CACHE_V es parte de la llave: súbelo cuando cambie el
     formato de la respuesta o las reglas, si no una respuesta vieja se queda
     servida hasta 24 h. */
  const CACHE_V = '6';
  const debug = url.searchParams.get('debug') === '1';
  const cache = caches.default;
  const cacheKey = new Request(
    new URL(`/api/cp?cp=${cp}&v=${CACHE_V}`, url.origin).toString(), { method: 'GET' });
  if (!debug) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }

  let r, fallo = null;
  try {
    r = await consultaEnvia(cp);
  } catch (e) {
    fallo = String((e && e.message) || e);
  }

  /* El estado debe cuadrar con el prefijo del C.P. Si no, no damos la lista:
     vale más dejar la colonia como texto libre que sugerir una equivocada. */
  if (r && !(r.estado && clave(r.estado) === clave(estadoLocal))) {
    fallo = `estado "${r.estado}" no cuadra con ${estadoLocal}`;
    r = null;
  }

  const colonias = r ? limpiaColonias(r.colonias) : [];

  if (!colonias.length) {
    /* Sin lista, pero el front-end ya tiene el estado por el prefijo y deja
       escribir la colonia a mano: la venta nunca se frena. */
    return json({
      ok: false, cp, estado: estadoLocal, colonias: [],
      error: 'No pudimos obtener las colonias de este C.P.',
      ...(debug ? { _detalle: fallo } : {}),
    }, 200);
  }

  const salida = {
    ok: true, cp,
    estado: r.estado || estadoLocal,
    municipio: r.municipio || '',
    ciudad: r.ciudad || r.municipio || '',
    colonias,
    fuente: r.fuente,
  };

  if (debug) return json({ ...salida, _detalle: fallo }, 200, { 'Cache-Control': 'no-store' });

  const out = json(salida);
  try { await cache.put(cacheKey, out.clone()); } catch (_) { /* caché opcional */ }
  return out;
}
