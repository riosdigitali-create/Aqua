/**
 * GET /api/cp?cp=97000
 * ---------------------------------------------------------------------------
 * Devuelve estado, municipio, ciudad y la lista de COLONIAS de un código
 * postal mexicano, para que el checkout pueda autocompletar y forzar la
 * selección correcta (evita direcciones mal escritas → menos devoluciones
 * y menos envíos perdidos).
 *
 * Respuesta:
 *   { ok:true, cp:"97000", estado:"Yucatán", municipio:"Mérida",
 *     ciudad:"Mérida", colonias:["Centro", ...], fuente:"sepomex-hckdrk" }
 *   { ok:false, error:"..." }
 *
 * Diseño:
 *  - Prueba varios proveedores en cadena. Si uno se cae, sigue el siguiente.
 *  - El estado SIEMPRE se resuelve, incluso sin red, con los rangos oficiales
 *    del prefijo del C.P. (el front-end también lo hace por su cuenta).
 *  - Cachea 24 h en el borde de Cloudflare → casi todas las consultas salen
 *    de caché y no gastan cuota de los proveedores.
 *
 * Variable opcional en Cloudflare (Settings → Environment variables):
 *    COPOMEX_TOKEN   → token REAL de api.copomex.com. Sin él, ese proveedor
 *                      se salta: el token público 'pruebas' devuelve datos
 *                      aleatorios y le mostraría colonias inventadas al cliente.
 *
 * Toda respuesta se valida contra el estado que deduce el prefijo del C.P.
 * Si no coincide, se descarta. Preferimos no dar lista a dar una falsa.
 * ---------------------------------------------------------------------------
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/* prefijo (2 primeros dígitos) → estado. Rangos oficiales SEPOMEX. */
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

/* limpia y deduplica nombres de colonias */
function limpiaColonias(lista) {
  const out = [];
  const vistos = new Set();
  for (const raw of lista) {
    const v = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!v) continue;
    const k = v.toLowerCase();
    if (vistos.has(k)) continue;
    vistos.add(k);
    out.push(v);
  }
  return out.sort((a, b) => a.localeCompare(b, 'es'));
}

async function pedir(url, ms = 6000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'aquamid-cp/1.0' },
    });
    if (!r.ok) throw new Error('http ' + r.status);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

/* ------------------------------- proveedores ------------------------------ */

async function provSepomexHckdrk(cp) {
  const d = await pedir(`https://api-sepomex.hckdrk.mx/query/info_cp/${cp}?type=simplified`);
  const r = d && d.response;
  if (!r) throw new Error('formato');
  const col = Array.isArray(r.asentamiento) ? r.asentamiento
            : r.asentamiento ? [r.asentamiento] : [];
  return {
    estado: r.estado || '',
    municipio: r.municipio || '',
    ciudad: r.ciudad || r.municipio || '',
    colonias: col,
    fuente: 'sepomex-hckdrk',
  };
}

async function provIcalia(cp) {
  const d = await pedir(`https://sepomex.icalialabs.com/api/v1/zip_codes?zip_code=${cp}`);
  const rows = (d && d.zip_codes) || [];
  if (!rows.length) throw new Error('vacío');
  return {
    estado: rows[0].d_estado || '',
    municipio: rows[0].d_mnpio || '',
    ciudad: rows[0].d_ciudad || rows[0].d_mnpio || '',
    colonias: rows.map(r => r.d_asenta),
    fuente: 'icalia-sepomex',
  };
}

async function provCopomex(cp, token) {
  // ⚠️ El token público 'pruebas' devuelve datos ALEATORIOS (estado "LFvRE",
  // colonias "6dR9e6oOCAwwU"...). Sin un token real no usamos este proveedor.
  const t = (token || '').trim();
  if (!t || t.toLowerCase() === 'pruebas') throw new Error('sin token real de copomex');
  const d = await pedir(`https://api.copomex.com/query/info_cp/${cp}?token=${encodeURIComponent(t)}`);
  const arr = Array.isArray(d) ? d : [d];
  const first = arr[0] && arr[0].response;
  if (!first) throw new Error('formato');
  const colonias = [];
  let estado = '', municipio = '', ciudad = '';
  for (const item of arr) {
    const r = item && item.response;
    if (!r) continue;
    estado = estado || (r.estado || '');
    municipio = municipio || (r.municipio || '');
    ciudad = ciudad || (r.ciudad || r.municipio || '');
    if (r.asentamiento) colonias.push(r.asentamiento);
    if (Array.isArray(r.asentamientos)) colonias.push(...r.asentamientos);
  }
  return { estado, municipio, ciudad, colonias, fuente: 'copomex' };
}

/* solo estado/ciudad — último recurso, sin colonias */
async function provZippo(cp) {
  const d = await pedir(`https://api.zippopotam.us/mx/${cp}`);
  const places = (d && d.places) || [];
  if (!places.length) throw new Error('vacío');
  return {
    estado: places[0].state || '',
    municipio: '',
    ciudad: places[0]['place name'] || '',
    colonias: places.map(p => p['place name']).filter(Boolean),
    fuente: 'zippopotam',
  };
}

/* ------------------------------- handler --------------------------------- */

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const cp = (url.searchParams.get('cp') || '').replace(/\D/g, '').slice(0, 5);

  if (cp.length !== 5) {
    return json({ ok: false, error: 'C.P. inválido: se esperan 5 dígitos.' }, 400);
  }

  const estadoLocal = estadoPorPrefijo(cp);
  if (!estadoLocal) {
    return json({ ok: false, cp, error: 'Ese C.P. no corresponde a ningún estado de México.' }, 404);
  }

  /* Caché del borde. CACHE_V forma parte de la llave: al subirlo, todo lo
     guardado antes queda huérfano y se vuelve a consultar. Súbelo cada vez que
     cambie el formato de la respuesta o las reglas de validación — si no, una
     respuesta mala se queda servida hasta 24 h. */
  const CACHE_V = '2';
  const cache = caches.default;
  const cacheKey = new Request(
    new URL(`/api/cp?cp=${cp}&v=${CACHE_V}`, url.origin).toString(), { method: 'GET' });
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const intentos = [
    () => provSepomexHckdrk(cp),
    () => provIcalia(cp),
    () => provCopomex(cp, env && env.COPOMEX_TOKEN),
    () => provZippo(cp),
  ];

  /* Red de seguridad: el estado que devuelve el proveedor TIENE que coincidir
     con el que deduce el prefijo del C.P. Si no coincide, son datos basura
     (o el proveedor se equivocó) y los descartamos. Vale más no dar lista de
     colonias que dar una inventada: el cliente escribiría una dirección falsa. */
  const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                     .toLowerCase().replace(/[^a-z]/g, '');
  const ALIAS = { ciudaddemexico: 'cdmx', distritofederal: 'cdmx', df: 'cdmx',
                  mexico: 'estadodemexico', edomex: 'estadodemexico',
                  veracruzdeignaciodelallave: 'veracruz', michoacandeocampo: 'michoacan',
                  coahuiladezaragoza: 'coahuila' };
  const clave = s => { const k = norm(s); return ALIAS[k] || k; };
  const coincideEstado = e => !!e && clave(e) === clave(estadoLocal);

  /* Un nombre de colonia real tiene vocales y no es una cadena aleatoria */
  const pareceNombre = v => /[aeiouáéíóú]/i.test(v) && /^[\p{L}\p{N}\s.,'’\-/()]+$/u.test(v);

  let res = null;
  const fallos = [];
  for (const intento of intentos) {
    try {
      const r = await intento();
      if (!coincideEstado(r.estado)) {
        fallos.push(`${r.fuente}: estado "${r.estado}" no es ${estadoLocal} — datos descartados`);
        continue;
      }
      const colonias = limpiaColonias(r.colonias).filter(pareceNombre);
      if (colonias.length) { res = { ...r, colonias }; break; }
      fallos.push(`${r.fuente}: sin colonias válidas`);
    } catch (e) {
      fallos.push(String((e && e.message) || e));
    }
  }

  /* ningún proveedor respondió: devolvemos al menos el estado, con ok:false
     para que el front-end deje la colonia como texto libre y no frene la venta */
  if (!res) {
    return json({
      ok: false,
      cp,
      estado: estadoLocal,
      colonias: [],
      error: 'No pudimos verificar las colonias de este C.P.',
      detalle: fallos,
    }, 200);
  }

  const salida = {
    ok: true,
    cp,
    estado: res.estado || estadoLocal,
    municipio: res.municipio || '',
    ciudad: res.ciudad || res.municipio || '',
    colonias: res.colonias,
    fuente: res.fuente,
  };

  const out = json(salida);
  try { await cache.put(cacheKey, out.clone()); } catch (_) { /* caché opcional */ }
  return out;
}
