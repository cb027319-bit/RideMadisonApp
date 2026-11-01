// Ride Madison welcome email: branded HTML + plain-text version, English and Spanish.
// Pure TypeScript (no Deno or Node APIs) so the Edge Function and the local preview
// script share it. Table-based layout and inline styles for Gmail/Outlook/Apple Mail.

export type WelcomeLang = 'en' | 'es';

export interface WelcomeInput {
  name?: string | null;
  lang?: WelcomeLang;
  /** Hosted PNG of the horizontal logo on navy (600×120 @2x). Text wordmark if absent. */
  logoUrl?: string | null;
  /** Where "Open Ride Madison" goes. */
  appUrl?: string;
  /** Shown in the footer (CAN-SPAM friendly). */
  mailingAddress?: string | null;
}

const NAVY = '#14213D';
const RED = '#E63946';
const GOLD = '#F4B740';
const CREAM = '#F4F1EA';
const LIMESTONE = '#E9E4DA';
const SLATE = '#4A4F5E';
const FONT = "'Red Hat Display', 'Helvetica Neue', Helvetica, Arial, sans-serif";

const COPY = {
  en: {
    subject: (n: string) => (n ? `Welcome to the Ride Madison community, ${n}!` : 'Welcome to the Ride Madison community!'),
    preheader: 'Your free local guide to Greater Madison’s trails, quiet routes and rides.',
    hello: (n: string) => (n ? `Welcome, ${n}!` : 'Welcome to the community!'),
    intro:
      'Thanks for joining Ride Madison. You’re now part of a community of Greater Madison riders who’d rather be on the trail. Here’s how to get the most out of the app.',
    stepsTitle: 'Get rolling in 3 steps',
    steps: [
      ['Tell us how you ride', 'In More → Your riding, pick your bike and comfort level. Routes will favor paths and quiet streets if that’s your style.'],
      ['Plan a ride', 'Tap “Where to?” on the map, pick a place, and see how much of the ride is on trails, bike lanes and quiet streets.'],
      ['Start riding', 'Tap Start ride for turn-by-turn directions with voice. Finish your first ride to earn the First Ride badge.'],
    ],
    ridesTitle: 'Three great first rides',
    rides: [
      ['Lake Monona Loop', 'The classic loop around the lake, past Monona Terrace, Olbrich Gardens and Olin Park, with lake views most of the way.'],
      ['Arboretum & Lake Wingra', 'An easy loop on quiet roads and paths through the UW Arboretum and around Lake Wingra. Great with kids.'],
      ['Capital City Trail to Lake Farm Park', 'A smooth, car-free trail through the marshes on the south side.'],
    ],
    ridesNote: 'Find these and more under Route → Suggested rides, with a virtual preview before you go.',
    goodTitle: 'Good to know',
    good: [
      ['Trail passes', 'Trails inside Madison are free. Some state trails (like parts of the Capital City, Military Ridge and Badger trails) need a Wisconsin state trail pass for riders 16+: $5 a day or $25 a year. Each trail card in the app tells you.'],
      ['E-bikes', 'Class 1 and 3 e-bikes are welcome on state trails at up to 15 mph. Class 2 riders pedal without the throttle there. The app shows the rule for your bike.'],
      ['BCycle', 'No bike? Madison’s BCycle e-bikes are on the map with live counts. Unlock one in the BCycle app and return it to any station with an open spot.'],
    ],
    statsTitle: 'Track your miles and earn badges',
    stats:
      'Every ride you finish with directions adds to your stats in More: miles, moving time, average speed, feet climbed and CO₂ saved. Collect badges like Century Club, Early Bird and Lake Monona Loop.',
    cta: 'Open Ride Madison',
    replyTitle: 'We’d love to hear from you',
    reply: 'Found a trail we’re missing or have an idea? Just reply to this email. A real person in Madison reads every message.',
    signoff: 'See you on the trail,',
    team: 'The Ride Madison team',
    footerWhy:
      'You’re getting this one-time email because you created a Ride Madison account. We only send news and offers if you said yes to them.',
    footerMade: 'Made in Madison, Wisconsin',
  },
  es: {
    subject: (n: string) => (n ? `¡Bienvenido a la comunidad de Ride Madison, ${n}!` : '¡Bienvenido a la comunidad de Ride Madison!'),
    preheader: 'Tu guía local gratuita de senderos, rutas tranquilas y paseos en el área de Madison.',
    hello: (n: string) => (n ? `¡Te damos la bienvenida, ${n}!` : '¡Te damos la bienvenida a la comunidad!'),
    intro:
      'Gracias por unirte a Ride Madison. Ahora eres parte de una comunidad de ciclistas del área de Madison que prefieren estar en el sendero. Así le sacas el máximo provecho a la app.',
    stepsTitle: 'Empieza en 3 pasos',
    steps: [
      ['Cuéntanos cómo andas en bici', 'En Más → Cómo andas en bici, elige tu bici y tu nivel de comodidad. Si lo prefieres, las rutas darán prioridad a senderos y calles tranquilas.'],
      ['Planea un paseo', 'Toca “¿A dónde vas?” en el mapa, elige un lugar y mira cuánto del recorrido va por senderos, carriles para bicicletas y calles tranquilas.'],
      ['Empieza a pedalear', 'Toca Iniciar paseo para recibir indicaciones paso a paso con voz. Termina tu primer paseo y gana la insignia Primer paseo.'],
    ],
    ridesTitle: 'Tres paseos ideales para empezar',
    rides: [
      ['Lake Monona Loop', 'La vuelta clásica al lago, pasando por Monona Terrace, Olbrich Gardens y Olin Park, con vistas al lago casi todo el camino.'],
      ['Arboretum & Lake Wingra', 'Un recorrido fácil por calles tranquilas y senderos del UW Arboretum y alrededor del Lake Wingra. Ideal con niños.'],
      ['Capital City Trail to Lake Farm Park', 'Un sendero liso y sin autos que cruza los humedales del sur de la ciudad.'],
    ],
    ridesNote: 'Encuéntralos y muchos más en Ruta → Paseos sugeridos, con una vista previa virtual antes de salir.',
    goodTitle: 'Bueno saber',
    good: [
      ['Pases para senderos', 'Los senderos dentro de Madison son gratis. Algunos senderos estatales (como partes del Capital City, Military Ridge y Badger) requieren un pase estatal de Wisconsin para ciclistas de 16 años o más: $5 por día o $25 por año. La ficha de cada sendero en la app te lo indica.'],
      ['Bicis eléctricas', 'Las bicis eléctricas Clase 1 y 3 se permiten en los senderos estatales hasta 15 mph. Con Clase 2, ahí se pedalea sin acelerador. La app te muestra la regla para tu bici.'],
      ['BCycle', '¿No tienes bici? Las bicis eléctricas BCycle de Madison aparecen en el mapa con disponibilidad en vivo. Desbloquea una en la app de BCycle y devuélvela en cualquier estación con espacio libre.'],
    ],
    statsTitle: 'Suma millas y gana insignias',
    stats:
      'Cada paseo que terminas con indicaciones se suma a tus estadísticas en Más: millas, tiempo en movimiento, velocidad promedio, pies de subida y CO₂ ahorrado. Colecciona insignias como Club de las 100, Madrugador y Lake Monona Loop.',
    cta: 'Abrir Ride Madison',
    replyTitle: 'Nos encantaría saber de ti',
    reply: '¿Conoces un sendero que nos falta o tienes una idea? Solo responde a este correo. Una persona real en Madison lee cada mensaje.',
    signoff: 'Nos vemos en el sendero,',
    team: 'El equipo de Ride Madison',
    footerWhy:
      'Recibes este correo una sola vez porque creaste una cuenta en Ride Madison. Solo te enviamos noticias y ofertas si aceptaste recibirlas.',
    footerMade: 'Hecho en Madison, Wisconsin',
  },
} as const;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function firstName(name?: string | null): string {
  return (name ?? '').trim().split(/\s+/)[0]?.slice(0, 40) ?? '';
}

export function welcomeEmail(input: WelcomeInput): { subject: string; html: string; text: string } {
  const lang: WelcomeLang = input.lang === 'es' ? 'es' : 'en';
  const c = COPY[lang];
  const n = firstName(input.name);
  const appUrl = input.appUrl ?? 'https://ridemadison.com';
  const subject = c.subject(n);

  const logo = input.logoUrl
    ? `<img src="${esc(input.logoUrl)}" width="240" height="48" alt="Ride Madison" style="display:block;border:0;width:240px;height:auto;">`
    : `<span style="font-family:${FONT};font-size:30px;line-height:36px;color:#ffffff;letter-spacing:-0.5px;"><b style="font-weight:900;">Ride</b><span style="font-weight:300;">Madison</span><sup style="font-size:12px;font-weight:700;">™</sup></span>`;

  const h2 = (s: string) =>
    `<h2 style="margin:0 0 14px;font-family:${FONT};font-size:20px;line-height:26px;font-weight:900;color:${NAVY};">${esc(s)}</h2>`;

  const steps = c.steps
    .map(
      ([title, body], i) => `
      <tr>
        <td width="44" valign="top" style="padding:0 14px 16px 0;">
          <div style="width:36px;height:36px;border-radius:18px;background:${RED};color:#ffffff;font-family:${FONT};font-size:17px;font-weight:900;line-height:36px;text-align:center;">${i + 1}</div>
        </td>
        <td valign="top" style="padding:0 0 16px;font-family:${FONT};font-size:15px;line-height:22px;color:${SLATE};">
          <b style="color:${NAVY};font-size:16px;">${esc(title)}</b><br>${esc(body)}
        </td>
      </tr>`,
    )
    .join('');

  const rides = c.rides
    .map(
      ([title, body]) => `
      <tr><td style="padding:0 0 10px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM};border-radius:12px;">
          <tr><td style="padding:14px 16px;font-family:${FONT};font-size:15px;line-height:21px;color:${SLATE};border-left:4px solid #15803d;border-radius:12px;">
            <b style="color:${NAVY};font-size:16px;">${esc(title)}</b><br>${esc(body)}
          </td></tr>
        </table>
      </td></tr>`,
    )
    .join('');

  const good = c.good
    .map(
      ([title, body]) => `
      <p style="margin:0 0 12px;font-family:${FONT};font-size:15px;line-height:22px;color:${SLATE};">
        <b style="color:${NAVY};">${esc(title)}.</b> ${esc(body)}
      </p>`,
    )
    .join('');

  const button = `
    <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:8px auto 0;">
      <tr><td align="center" bgcolor="${RED}" style="border-radius:12px;">
        <a href="${esc(appUrl)}" style="display:inline-block;padding:15px 34px;font-family:${FONT};font-size:17px;font-weight:900;color:#ffffff;text-decoration:none;border-radius:12px;">${esc(c.cta)}</a>
      </td></tr>
    </table>`;

  const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${LIMESTONE};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(c.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${LIMESTONE};">
  <tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:18px;overflow:hidden;">
      <tr><td style="background:${NAVY};padding:28px 32px 24px;">
        ${logo}
        <div style="height:3px;width:56px;background:${RED};margin-top:18px;border-radius:2px;"></div>
      </td></tr>
      <tr><td style="padding:32px 32px 8px;">
        <h1 style="margin:0 0 12px;font-family:${FONT};font-size:28px;line-height:34px;font-weight:900;color:${NAVY};">${esc(c.hello(n))}</h1>
        <p style="margin:0 0 26px;font-family:${FONT};font-size:16px;line-height:24px;color:${SLATE};">${esc(c.intro)}</p>
        ${h2(c.stepsTitle)}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${steps}</table>
        ${button}
      </td></tr>
      <tr><td style="padding:28px 32px 8px;">
        ${h2(c.ridesTitle)}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rides}</table>
        <p style="margin:4px 0 0;font-family:${FONT};font-size:14px;line-height:20px;color:${SLATE};">${esc(c.ridesNote)}</p>
      </td></tr>
      <tr><td style="padding:28px 32px 8px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${NAVY};border-radius:14px;">
          <tr><td style="padding:22px 22px 20px;">
            <div style="font-family:${FONT};font-size:12px;font-weight:900;letter-spacing:1.5px;color:${GOLD};text-transform:uppercase;margin-bottom:6px;">★ ★ ★</div>
            <div style="font-family:${FONT};font-size:19px;line-height:25px;font-weight:900;color:#ffffff;margin-bottom:8px;">${esc(c.statsTitle)}</div>
            <div style="font-family:${FONT};font-size:15px;line-height:22px;color:${LIMESTONE};">${esc(c.stats)}</div>
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:28px 32px 8px;">
        ${h2(c.goodTitle)}
        ${good}
      </td></tr>
      <tr><td style="padding:20px 32px 32px;">
        ${h2(c.replyTitle)}
        <p style="margin:0 0 20px;font-family:${FONT};font-size:15px;line-height:22px;color:${SLATE};">${esc(c.reply)}</p>
        <p style="margin:0;font-family:${FONT};font-size:15px;line-height:22px;color:${NAVY};">${esc(c.signoff)}<br><b>${esc(c.team)}</b></p>
      </td></tr>
      <tr><td style="background:${CREAM};padding:20px 32px;font-family:${FONT};font-size:12px;line-height:18px;color:${SLATE};">
        ${esc(c.footerWhy)}<br><br>
        <b style="color:${NAVY};">Ride Madison™</b> · ${esc(c.footerMade)}${input.mailingAddress ? `<br>${esc(input.mailingAddress)}` : ''}<br>
        <a href="https://ridemadison.com/privacy" style="color:${NAVY};">Privacy</a> · <a href="https://ridemadison.com/terms" style="color:${NAVY};">Terms</a>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  const text = [
    c.hello(n),
    '',
    c.intro,
    '',
    c.stepsTitle.toUpperCase(),
    ...c.steps.map(([a, b], i) => `${i + 1}. ${a}: ${b}`),
    '',
    `${c.cta}: ${appUrl}`,
    '',
    c.ridesTitle.toUpperCase(),
    ...c.rides.map(([a, b]) => `- ${a}: ${b}`),
    c.ridesNote,
    '',
    c.statsTitle.toUpperCase(),
    c.stats,
    '',
    c.goodTitle.toUpperCase(),
    ...c.good.map(([a, b]) => `- ${a}: ${b}`),
    '',
    c.reply,
    '',
    c.signoff,
    c.team,
    '',
    '--',
    c.footerWhy,
    `Ride Madison · ${c.footerMade}${input.mailingAddress ? ` · ${input.mailingAddress}` : ''}`,
  ].join('\n');

  return { subject, html, text };
}
