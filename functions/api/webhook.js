// Cloudflare Pages Function  ->  /api/webhook
// Mercado Pago envía aquí el aviso cuando se procesa un pago.
// Cuando el pago queda "approved" puedes (opcional) generar la guía en Envia.com.
// Requiere: MP_ACCESS_TOKEN (y para la guía real: ENVIA_TOKEN + datos de origen).

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
        // ✅ Pago confirmado. Aquí puedes crear la guía en Envia.com automáticamente.
        // Descomenta y completa con los datos de tu remitente cuando quieras activarlo:
        //
        // await fetch('https://api.envia.com/ship/generate/', {
        //   method: 'POST',
        //   headers: { 'Content-Type':'application/json', 'Authorization':'Bearer '+env.ENVIA_TOKEN },
        //   body: JSON.stringify({ /* origin, destination (pay.metadata.customer), packages, shipment.carrier ... */ })
        // });
        console.log('Pago aprobado', paymentId, JSON.stringify(pay.metadata || {}));
      }
    }
    return new Response('ok', { status: 200 });
  } catch (e) {
    // Responder 200 siempre para que Mercado Pago no reintente en bucle.
    return new Response('ok', { status: 200 });
  }
}
